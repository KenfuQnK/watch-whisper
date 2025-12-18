import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Plus, ListFilter, Film, Tv, Download, Upload, Filter, Calendar, Loader2, Ban } from 'lucide-react';
import { MediaItem, User, MediaType, CollectionType, SearchResult, WatchInfo } from './types';
import MediaCard from './components/MediaCard';
import WatchedModal from './components/WatchedModal';
import SearchOverlay from './components/SearchOverlay';
import Avatar from './components/Avatar';
import WhisperChat from './components/WhisperChat';
import { getSeriesDetails, enrichMediaContent } from './services/gemini';
import { fetchMediaItems, addMediaItem, updateMediaItem, deleteMediaItem } from './services/db';
import { supabase } from './lib/supabase';

const USERS: User[] = [
  { id: 'u1', name: 'Jesús', avatar: 'https://c8rdtkrvdfv40ceo.public.blob.vercel-storage.com/imgJesus.PNG', color: '#6366f1' },
  { id: 'u2', name: 'Julia', avatar: 'https://c8rdtkrvdfv40ceo.public.blob.vercel-storage.com/imgJulia.PNG', color: '#ec4899' },
];

type UiTab = 'pending' | 'inprogress' | 'finished' | 'discarded';

const App: React.FC = () => {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<UiTab>('pending');
  const [activeFilter, setActiveFilter] = useState<'all' | MediaType>('all');
  const [userFilter, setUserFilter] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  useEffect(() => {
    const loadData = async (isInitial = false) => {
      if (isInitial) setIsLoading(true);
      const data = await fetchMediaItems();
      setItems(data);
      if (isInitial) setIsLoading(false);
    };
    loadData(true);
    const channel = supabase.channel('media_changes').on('postgres_changes', { event: '*', schema: 'public', table: 'media_items' }, () => loadData(false)).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    if (selectedItem) {
      const updated = items.find(i => i.id === selectedItem.id);
      if (updated) setSelectedItem(updated);
    }
  }, [items]);

  const getTotalEpisodes = (item: MediaItem) => item.type === MediaType.MOVIE ? 1 : item.seasons?.reduce((acc, s) => acc + s.episodeCount, 0) || 0;

  const getStatusCounts = (item: MediaItem) => {
      let startedCount = 0;
      let finishedCount = 0;
      const totalEpisodes = getTotalEpisodes(item);
      USERS.forEach(user => {
          const status = item.userStatus[user.id];
          if (!status) return;
          if (item.type === MediaType.MOVIE) {
              if (status.watched) { startedCount++; finishedCount++; }
          } else {
              const watchedEps = status.watchedEpisodes?.length || 0;
              if (watchedEps > 0) startedCount++;
              if (totalEpisodes > 0 && watchedEps >= totalEpisodes) finishedCount++;
          }
      });
      return { startedCount, finishedCount };
  };

  const filteredItems = useMemo(() => {
    return items.filter(item => {
        if (item.rating === 9) return activeTab === 'discarded';
        if (activeTab === 'discarded') return false;
        const { startedCount, finishedCount } = getStatusCounts(item);
        if (activeTab === 'pending') { if (startedCount > 0) return false; }
        else if (activeTab === 'inprogress') { if (startedCount === 0 || finishedCount === USERS.length) return false; }
        else if (activeTab === 'finished') { if (finishedCount < USERS.length) return false; }
        if (activeFilter !== 'all' && item.type !== activeFilter) return false;
        if (userFilter) {
            const s = item.userStatus[userFilter];
            const hasActivity = s && (s.watched || (s.watchedEpisodes && s.watchedEpisodes.length > 0));
            if (activeTab !== 'pending' && !hasActivity) return false;
        }
        return true;
    }).sort((a, b) => b.addedAt - a.addedAt);
  }, [items, activeTab, activeFilter, userFilter]);

  const counts = useMemo(() => {
      let pending = 0, inprogress = 0, finished = 0, discarded = 0;
      items.forEach(item => {
          if (item.rating === 9) { discarded++; return; }
          const { startedCount, finishedCount } = getStatusCounts(item);
          if (startedCount === 0) pending++;
          else if (finishedCount === USERS.length) finished++;
          else inprogress++;
      });
      return { pending, inprogress, finished, discarded };
  }, [items]);

  const handleAddItem = async (result: SearchResult, initialUserStatus?: Record<string, WatchInfo>) => {
    if (items.some(i => i.title === result.title && i.year === result.year)) return;
    
    // Fetch full details including episodes and platforms
    const finalResult = await getSeriesDetails(result);
    let userStatus = initialUserStatus || {};

    if (initialUserStatus && finalResult.type === MediaType.SERIES && finalResult.seasons) {
         Object.keys(initialUserStatus).forEach(uid => {
             if (initialUserStatus[uid].watched) {
                 const allEps = finalResult.seasons!.flatMap(s => Array.from({length: s.episodeCount}, (_, i) => `S${s.seasonNumber}_E${i+1}`));
                 userStatus[uid].watchedEpisodes = allEps;
             }
         });
    }

    const newItem: MediaItem = {
        id: Date.now().toString(),
        ...finalResult, 
        collectionId: Object.values(userStatus).some(s => s.watched || s.watchedEpisodes?.length > 0) ? CollectionType.WATCHED : CollectionType.WATCHLIST,
        addedAt: Date.now(),
        userStatus,
        seasons: finalResult.seasons || [],
        platform: finalResult.platforms || [], 
        releaseDate: finalResult.releaseDate || '',
        rating: undefined, 
        trailerUrl: '', 
        isEnriched: false
    };

    setItems(prev => [newItem, ...prev]);
    try {
        await addMediaItem(newItem);
        enrichMediaContent(newItem);
    } catch (e) {
        setItems(prev => prev.filter(i => i.id !== newItem.id));
    }
  };

  const handleUpdateItem = async (itemId: string, changes: Partial<MediaItem>) => {
      setItems(prev => prev.map(item => item.id === itemId ? { ...item, ...changes } : item));
      if (selectedItem && selectedItem.id === itemId) setSelectedItem(prev => prev ? { ...prev, ...changes } : null);
      await updateMediaItem(itemId, changes);
  };

  const handleDelete = async (itemId: string) => {
    setItems(prev => prev.filter(i => i.id !== itemId));
    await deleteMediaItem(itemId);
  };

  if (isLoading) return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white"><Loader2 className="animate-spin mr-2" /> Cargando...</div>;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 pb-20">
      <header className="sticky top-0 z-40 bg-slate-900/80 backdrop-blur-md border-b border-slate-800">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-10 h-8 rounded-lg bg-gradient-to-tr from-indigo-500 to-pink-500 flex items-center justify-center font-bold text-white tracking-widest text-sm">WW</div>
            <h1 className="text-xl font-bold tracking-tight">Watch Whisper <span className="text-[10px] text-slate-500 border border-slate-700 rounded px-1 ml-1">CLOUD</span></h1>
          </div>
          <div className="flex items-center gap-4">
              <div className="flex gap-3">{USERS.map(u => <Avatar key={u.id} user={u} size="sm" className="border-slate-800 shadow-sm" />)}</div>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-4 flex gap-6 overflow-x-auto no-scrollbar mt-2 md:mt-0">
          <button onClick={() => setActiveTab('pending')} className={`pb-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 shrink-0 ${activeTab === 'pending' ? 'border-indigo-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'}`}>Pendientes <span className="bg-slate-800 px-2 rounded-full text-xs text-slate-400">{counts.pending}</span></button>
          <button onClick={() => setActiveTab('inprogress')} className={`pb-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 shrink-0 ${activeTab === 'inprogress' ? 'border-orange-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'}`}>A Medias <span className="bg-slate-800 px-2 rounded-full text-xs text-slate-400">{counts.inprogress}</span></button>
          <button onClick={() => setActiveTab('finished')} className={`pb-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 shrink-0 ${activeTab === 'finished' ? 'border-green-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'}`}>Terminados <span className="bg-slate-800 px-2 rounded-full text-xs text-slate-400">{counts.finished}</span></button>
          <button onClick={() => setActiveTab('discarded')} className={`pb-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 shrink-0 ${activeTab === 'discarded' ? 'border-red-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'}`}>Descartados <span className="bg-slate-800 px-2 rounded-full text-xs text-slate-400">{counts.discarded}</span></button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
            <div className="flex bg-slate-800 p-1 rounded-lg">
                <button onClick={() => setActiveFilter('all')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${activeFilter === 'all' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}>Todo</button>
                <button onClick={() => setActiveFilter(MediaType.MOVIE)} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1 ${activeFilter === MediaType.MOVIE ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}><Film size={12} /> Pelis</button>
                <button onClick={() => setActiveFilter(MediaType.SERIES)} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1 ${activeFilter === MediaType.SERIES ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}><Tv size={12} /> Series</button>
            </div>
            <div className="flex items-center gap-2">
                <button onClick={() => setUserFilter(userFilter === USERS[0].id ? null : USERS[0].id)} className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all border ${userFilter === USERS[0].id ? 'bg-indigo-500/20 border-indigo-500 text-indigo-300' : 'bg-slate-800 border-transparent text-slate-400 hover:bg-slate-700'}`}>{USERS[0].name}</button>
                <button onClick={() => setUserFilter(userFilter === USERS[1].id ? null : USERS[1].id)} className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all border ${userFilter === USERS[1].id ? 'bg-pink-500/20 border-pink-500 text-pink-300' : 'bg-slate-800 border-transparent text-slate-400 hover:bg-slate-700'}`}>{USERS[1].name}</button>
            </div>
        </div>

        {filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-500">
                <ListFilter size={48} className="mb-4 opacity-50" /><p className="text-lg">No hay nada por aquí.</p>
            </div>
        ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 sm:gap-6">
            {filteredItems.map(item => <MediaCard key={item.id} item={item} users={USERS} onClick={(i) => setSelectedItem(i)} />)}
            </div>
        )}
      </main>

      <WhisperChat items={items} users={USERS} onAdd={handleAddItem} onUpdate={handleUpdateItem} />
      <button onClick={() => setIsSearchOpen(true)} className="fixed bottom-6 right-6 bg-indigo-600 hover:bg-indigo-500 text-white p-4 rounded-full shadow-2xl transition-transform hover:scale-110 active:scale-95 z-30 flex items-center justify-center"><Plus size={28} /></button>

      <WatchedModal isOpen={!!selectedItem} item={selectedItem} users={USERS} onClose={() => setSelectedItem(null)} onUpdateItem={handleUpdateItem} onUpdateStatus={() => {}} onDelete={handleDelete} />
      <SearchOverlay isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} onAdd={(result) => handleAddItem(result)} />
    </div>
  );
};

export default App;
