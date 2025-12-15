import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Plus, ListFilter, Film, Tv, Download, Upload, Filter, Calendar, Loader2, Ban } from 'lucide-react';
import { MediaItem, User, MediaType, CollectionType, SearchResult, WatchInfo } from './types';
import MediaCard from './components/MediaCard';
import WatchedModal from './components/WatchedModal';
import SearchOverlay from './components/SearchOverlay';
import Avatar from './components/Avatar';
import WhisperChat from './components/WhisperChat'; // IMPORTED
import { getSeriesDetails, enrichMediaContent } from './services/gemini';
import { fetchMediaItems, addMediaItem, updateMediaItem, deleteMediaItem } from './services/db';
import { supabase } from './lib/supabase';

// --- CONFIG ---
const USERS: User[] = [
  { id: 'u1', name: 'Jesús', avatar: 'https://c8rdtkrvdfv40ceo.public.blob.vercel-storage.com/imgJesus.PNG', color: '#6366f1' }, // Indigo
  { id: 'u2', name: 'Julia', avatar: 'https://c8rdtkrvdfv40ceo.public.blob.vercel-storage.com/imgJulia.PNG', color: '#ec4899' }, // Pink
];

// Define UI Tabs (Computed, not stored directly as CollectionType)
type UiTab = 'pending' | 'inprogress' | 'finished' | 'discarded';

const App: React.FC = () => {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [activeTab, setActiveTab] = useState<UiTab>('pending');
  const [activeFilter, setActiveFilter] = useState<'all' | MediaType>('all');
  const [userFilter, setUserFilter] = useState<string | null>(null); // ID of the user to filter by
  
  // Modal States
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  
  // File Input Ref for Import
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- SUPABASE INITIALIZATION & REALTIME ---
  useEffect(() => {
    // 1. Initial Fetch
    const loadData = async (isInitial = false) => {
      if (isInitial) setIsLoading(true);
      const data = await fetchMediaItems();
      setItems(data);
      if (isInitial) setIsLoading(false);
    };

    // Load initially with spinner
    loadData(true);

    // 2. Realtime Subscription
    const channel = supabase
      .channel('media_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'media_items' },
        (payload) => {
          // On change, simply reload data seamlessly without blocking UI
          loadData(false);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Update selectedItem when items change (for realtime modal updates)
  useEffect(() => {
    if (selectedItem) {
      const updated = items.find(i => i.id === selectedItem.id);
      if (updated) setSelectedItem(updated);
    }
  }, [items]);

  // --- HELPERS FOR STATUS ---
  
  // Calculate total episodes for a series
  const getTotalEpisodes = (item: MediaItem) => {
      if (item.type === MediaType.MOVIE) return 1;
      return item.seasons?.reduce((acc, s) => acc + s.episodeCount, 0) || 0;
  };

  const getStatusCounts = (item: MediaItem) => {
      let startedCount = 0;
      let finishedCount = 0;
      const totalEpisodes = getTotalEpisodes(item);

      USERS.forEach(user => {
          const status = item.userStatus[user.id];
          if (!status) return;

          if (item.type === MediaType.MOVIE) {
              if (status.watched) {
                  startedCount++;
                  finishedCount++;
              }
          } else {
              // Series Logic
              const watchedEps = status.watchedEpisodes?.length || 0;
              
              if (watchedEps > 0) {
                  startedCount++;
              }
              
              // STRICT Finished logic: Must watch ALL episodes
              // Only count as finished if we have episode data and user matched it
              if (totalEpisodes > 0 && watchedEps >= totalEpisodes) {
                  finishedCount++;
              }
          }
      });
      return { startedCount, finishedCount };
  };

  // --- FILTERING LOGIC ---
  const filteredItems = useMemo(() => {
    return items.filter(item => {
        
        // 1. Discarded Logic (Overrides everything else) -> NOW IS 9
        if (item.rating === 9) {
            return activeTab === 'discarded';
        }

        // If we are in the discarded tab, only show rating 9 items
        if (activeTab === 'discarded') return false;

        const { startedCount, finishedCount } = getStatusCounts(item);
        const totalUsers = USERS.length;

        // 2. Tab Logic (for non-discarded items)
        if (activeTab === 'pending') {
            // No one has started it
            if (startedCount > 0) return false;
        } else if (activeTab === 'inprogress') {
            // "A medias": At least one started, but NOT everyone has "finished"
            if (startedCount === 0) return false; // Pending
            if (finishedCount === totalUsers) return false; // Everyone finished it
        } else if (activeTab === 'finished') {
             // Everyone has strictly finished it
             if (finishedCount < totalUsers) return false;
        }

        // 3. Type Filter
        if (activeFilter !== 'all' && item.type !== activeFilter) return false;

        // 4. User Filter
        if (userFilter) {
            // Show item if this specific user has interacted with it
            const s = item.userStatus[userFilter];
            const hasActivity = s && (s.watched || (s.watchedEpisodes && s.watchedEpisodes.length > 0));
            
            // Allow showing in pending even if no activity (since user wants to see what is pending for THEM too maybe? 
            // Actually usually filters imply "show my stuff". For pending, it's everything.)
            // Let's keep logic: if filtering by user, show items that user has touched OR items that are pending.
            if (activeTab !== 'pending' && !hasActivity) return false;
        }

        return true;
    }).sort((a, b) => b.addedAt - a.addedAt);
  }, [items, activeTab, activeFilter, userFilter]);

  // Tab Counts for Badge
  const counts = useMemo(() => {
      let pending = 0, inprogress = 0, finished = 0, discarded = 0;
      items.forEach(item => {
          if (item.rating === 9) {
              discarded++;
              return;
          }
          const { startedCount, finishedCount } = getStatusCounts(item);
          if (startedCount === 0) pending++;
          else if (finishedCount === USERS.length) finished++;
          else inprogress++;
      });
      return { pending, inprogress, finished, discarded };
  }, [items]);

  const handleAddItem = async (result: SearchResult, markWatchedForUserId?: string) => {
    if (items.some(i => i.title === result.title && i.year === result.year)) {
        // If it exists but we want to mark it as watched (via Chatbot), we should technically update it,
        // but handleAddItem is usually for NEW items. 
        // The chatbot logic will check for existence FIRST, so this alert is mostly for manual UI.
        if (!markWatchedForUserId) alert("¡Ya tienes esto en tu lista!");
        return;
    }
    
    // --- STEP 1: Fast API Enrichment (Non-AI) ---
    // Get episodes structure for series
    let finalResult = result;
    if (result.type === MediaType.SERIES) {
        try {
             finalResult = await getSeriesDetails(result);
        } catch(e) {
            console.error("Error fetching episodes", e);
        }
    }

    // Prepare initial user status if requested (e.g. by Chatbot)
    const initialUserStatus: Record<string, WatchInfo> = {};
    if (markWatchedForUserId) {
        initialUserStatus[markWatchedForUserId] = {
            watched: true, // For movies
            date: Date.now(),
            watchedEpisodes: finalResult.type === MediaType.SERIES && finalResult.seasons 
                ? finalResult.seasons.flatMap(s => Array.from({length: s.episodeCount}, (_, i) => `S${s.seasonNumber}_E${i+1}`))
                : []
        };
    }

    const newItem: MediaItem = {
        id: Date.now().toString(),
        ...finalResult, 
        collectionId: markWatchedForUserId ? CollectionType.WATCHED : CollectionType.WATCHLIST,
        addedAt: Date.now(),
        userStatus: initialUserStatus,
        seasons: finalResult.seasons || [],
        platform: [], 
        releaseDate: '',
        rating: undefined, 
        trailerUrl: '', 
        isEnriched: false // Flag to trigger AI background process
    };

    // --- STEP 2: Optimistic UI & DB Save ---
    setItems(prev => [newItem, ...prev]);
    
    try {
        await addMediaItem(newItem);
        
        // --- STEP 3: AI Background Enrichment ---
        enrichMediaContent(newItem).then(() => {
            console.log("Background enrichment kicked off for:", newItem.title);
        });

    } catch (e) {
        console.error("Error adding item to DB", e);
        setItems(prev => prev.filter(i => i.id !== newItem.id));
    }
  };

  // Generic Update Handler
  const handleUpdateItem = async (itemId: string, changes: Partial<MediaItem>) => {
      // Optimistic Update
      setItems(prev => prev.map(item => item.id === itemId ? { ...item, ...changes } : item));
      if (selectedItem && selectedItem.id === itemId) {
          setSelectedItem(prev => prev ? { ...prev, ...changes } : null);
      }
      
      // DB Update
      await updateMediaItem(itemId, changes);
  };

  const handleDelete = async (itemId: string) => {
    setItems(prev => prev.filter(i => i.id !== itemId));
    await deleteMediaItem(itemId);
  };

  // --- IMPORT/EXPORT ---
  const handleExport = () => {
    const dataStr = JSON.stringify(items, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `watch_whisper_backup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleImportClick = () => {
      alert("La importación masiva directa está deshabilitada en modo Base de Datos para evitar conflictos. Contacta al admin.");
  };

  // Only show full screen loader on INITIAL load
  if (isLoading) {
      return (
          <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">
              <Loader2 className="animate-spin mr-2" /> Cargando Watch Whisper...
          </div>
      )
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 pb-20">
      
      {/* Header */}
      <header className="sticky top-0 z-40 bg-slate-900/80 backdrop-blur-md border-b border-slate-800">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-10 h-8 rounded-lg bg-gradient-to-tr from-indigo-500 to-pink-500 flex items-center justify-center font-bold text-white tracking-widest text-sm">
              WW
            </div>
            <h1 className="text-xl font-bold tracking-tight">Watch Whisper <span className="text-[10px] text-slate-500 border border-slate-700 rounded px-1 ml-1">CLOUD</span></h1>
          </div>

          <div className="flex items-center gap-4">
              <div className="flex items-center gap-1 bg-slate-800 rounded-lg p-1">
                 <button onClick={handleExport} className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-md transition-colors" title="Exportar Backup"><Download size={18} /></button>
                 <button onClick={handleImportClick} className="p-2 text-slate-600 cursor-not-allowed rounded-md transition-colors" title="Importar (Deshabilitado)"><Upload size={18} /></button>
              </div>
              <div className="h-6 w-px bg-slate-700 mx-2 hidden md:block"></div>
              <div className="flex gap-3">
                {USERS.map(u => (
                    <Avatar key={u.id} user={u} size="sm" className="border-slate-800 shadow-sm" />
                ))}
              </div>
          </div>
        </div>
        
        {/* Navigation Tabs (4 States) */}
        <div className="max-w-6xl mx-auto px-4 flex gap-6 overflow-x-auto no-scrollbar mt-2 md:mt-0">
          <button 
            onClick={() => setActiveTab('pending')}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 shrink-0 ${activeTab === 'pending' ? 'border-indigo-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
          >
            Pendientes <span className="bg-slate-800 px-2 rounded-full text-xs text-slate-400">{counts.pending}</span>
          </button>
          <button 
            onClick={() => setActiveTab('inprogress')}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 shrink-0 ${activeTab === 'inprogress' ? 'border-orange-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
          >
            A Medias <span className="bg-slate-800 px-2 rounded-full text-xs text-slate-400">{counts.inprogress}</span>
          </button>
          <button 
            onClick={() => setActiveTab('finished')}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 shrink-0 ${activeTab === 'finished' ? 'border-green-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
          >
            Terminados <span className="bg-slate-800 px-2 rounded-full text-xs text-slate-400">{counts.finished}</span>
          </button>
          <button 
            onClick={() => setActiveTab('discarded')}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 shrink-0 ${activeTab === 'discarded' ? 'border-red-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
          >
            Descartados <span className="bg-slate-800 px-2 rounded-full text-xs text-slate-400">{counts.discarded}</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 py-8">
        
        {/* Filters Row */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
            
            {/* Type Filters */}
            <div className="flex bg-slate-800 p-1 rounded-lg">
                <button 
                    onClick={() => setActiveFilter('all')}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${activeFilter === 'all' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}
                >
                    Todo
                </button>
                <button 
                    onClick={() => setActiveFilter(MediaType.MOVIE)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1 ${activeFilter === MediaType.MOVIE ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}
                >
                    <Film size={12} /> Pelis
                </button>
                <button 
                    onClick={() => setActiveFilter(MediaType.SERIES)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1 ${activeFilter === MediaType.SERIES ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}
                >
                    <Tv size={12} /> Series
                </button>
            </div>

            {/* User Filters (Only show when not in Pending, usually) */}
            <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 uppercase font-bold mr-1"><Filter size={12} className="inline mr-1" />Filtrar:</span>
                <button 
                    onClick={() => setUserFilter(userFilter === USERS[0].id ? null : USERS[0].id)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold transition-all border ${userFilter === USERS[0].id ? 'bg-indigo-500/20 border-indigo-500 text-indigo-300' : 'bg-slate-800 border-transparent text-slate-400 hover:bg-slate-700'}`}
                >
                    {USERS[0].name}
                </button>
                <button 
                    onClick={() => setUserFilter(userFilter === USERS[1].id ? null : USERS[1].id)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold transition-all border ${userFilter === USERS[1].id ? 'bg-pink-500/20 border-pink-500 text-pink-300' : 'bg-slate-800 border-transparent text-slate-400 hover:bg-slate-700'}`}
                >
                    {USERS[1].name}
                </button>
            </div>
        </div>

        {/* Grid */}
        {filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-500">
                <ListFilter size={48} className="mb-4 opacity-50" />
                <p className="text-lg">No hay nada por aquí.</p>
                <button onClick={() => setIsSearchOpen(true)} className="mt-4 text-indigo-400 hover:text-indigo-300">
                    ¿Añadir algo nuevo?
                </button>
            </div>
        ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 sm:gap-6">
            {filteredItems.map(item => (
                <MediaCard 
                    key={item.id} 
                    item={item} 
                    users={USERS}
                    onClick={(i) => setSelectedItem(i)} 
                />
            ))}
            </div>
        )}
      </main>

      {/* WHISPER CHATBOT (New) */}
      <WhisperChat 
        items={items} 
        users={USERS} 
        onAdd={handleAddItem}
        onUpdate={handleUpdateItem} // New prop for tool execution
      />

      {/* Floating Action Button */}
      <button 
        onClick={() => setIsSearchOpen(true)}
        className="fixed bottom-6 right-6 bg-indigo-600 hover:bg-indigo-500 text-white p-4 rounded-full shadow-2xl transition-transform hover:scale-110 active:scale-95 z-30 flex items-center justify-center"
      >
        <Plus size={28} />
      </button>

      {/* Overlays */}
      <WatchedModal 
        isOpen={!!selectedItem}
        item={selectedItem}
        users={USERS}
        onClose={() => setSelectedItem(null)}
        onUpdateItem={handleUpdateItem}
        onUpdateStatus={() => {}} // Deprecated but required by interface type in modal props currently
        onDelete={handleDelete}
      />

      <SearchOverlay 
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onAdd={handleAddItem}
      />

    </div>
  );
};

export default App;