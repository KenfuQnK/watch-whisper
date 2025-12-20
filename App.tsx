import React, { useState, useMemo, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, FlatList, useWindowDimensions, ActivityIndicator } from 'react-native';
import { Plus, ListFilter, Film, Tv } from 'lucide-react-native';
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
  const { width } = useWindowDimensions();

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
  }, [items, selectedItem]);

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

    const finalResult = await getSeriesDetails(result);
    let userStatus = initialUserStatus || {};

    if (initialUserStatus && finalResult.type === MediaType.SERIES && finalResult.seasons) {
      Object.keys(initialUserStatus).forEach(uid => {
        if (initialUserStatus[uid].watched) {
          const allEps = finalResult.seasons!.flatMap(s => Array.from({ length: s.episodeCount }, (_, i) => `S${s.seasonNumber}_E${i + 1}`));
          userStatus[uid].watchedEpisodes = allEps;
        }
      });
    }

    const newItem: MediaItem = {
      ...finalResult,
      collectionId: Object.values(userStatus).some(s => s.watched || s.watchedEpisodes?.length > 0) ? CollectionType.WATCHED : CollectionType.WATCHLIST,
      addedAt: Date.now(),
      userStatus,
      seasons: finalResult.seasons || [],
      platform: finalResult.platforms || [],
      releaseDate: finalResult.releaseDate || '',
      rating: undefined,
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

  const columnCount = width >= 1000 ? 5 : width >= 768 ? 4 : width >= 560 ? 3 : 2;

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-900">
        <View className="flex-row items-center">
          <ActivityIndicator color="#fff" />
          <Text className="text-white ml-2">Cargando...</Text>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-slate-900">
      <View className="bg-slate-900/80 border-b border-slate-800">
        <View className="px-4 py-4 flex-col gap-4">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <View className="w-10 h-8 rounded-lg bg-indigo-500 items-center justify-center">
                <Text className="font-bold text-white tracking-widest text-sm">WW</Text>
              </View>
              <Text className="text-xl font-bold text-white">Watch Whisper <Text className="text-[10px] text-slate-500 border border-slate-700 rounded px-1 ml-1">CLOUD</Text></Text>
            </View>
            <View className="flex-row gap-3">
              {USERS.map(u => <Avatar key={u.id} user={u} size="sm" className="border-slate-800" />)}
            </View>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row gap-6">
            <Pressable onPress={() => setActiveTab('pending')} className={`pb-3 flex-row items-center gap-2 ${activeTab === 'pending' ? 'border-b-2 border-indigo-500' : ''}`}>
              <Text className={activeTab === 'pending' ? 'text-white font-medium' : 'text-slate-500 font-medium'}>Pendientes</Text>
              <Text className="bg-slate-800 px-2 rounded-full text-xs text-slate-400">{counts.pending}</Text>
            </Pressable>
            <Pressable onPress={() => setActiveTab('inprogress')} className={`pb-3 flex-row items-center gap-2 ${activeTab === 'inprogress' ? 'border-b-2 border-orange-500' : ''}`}>
              <Text className={activeTab === 'inprogress' ? 'text-white font-medium' : 'text-slate-500 font-medium'}>A Medias</Text>
              <Text className="bg-slate-800 px-2 rounded-full text-xs text-slate-400">{counts.inprogress}</Text>
            </Pressable>
            <Pressable onPress={() => setActiveTab('finished')} className={`pb-3 flex-row items-center gap-2 ${activeTab === 'finished' ? 'border-b-2 border-green-500' : ''}`}>
              <Text className={activeTab === 'finished' ? 'text-white font-medium' : 'text-slate-500 font-medium'}>Terminados</Text>
              <Text className="bg-slate-800 px-2 rounded-full text-xs text-slate-400">{counts.finished}</Text>
            </Pressable>
            <Pressable onPress={() => setActiveTab('discarded')} className={`pb-3 flex-row items-center gap-2 ${activeTab === 'discarded' ? 'border-b-2 border-red-500' : ''}`}>
              <Text className={activeTab === 'discarded' ? 'text-white font-medium' : 'text-slate-500 font-medium'}>Descartados</Text>
              <Text className="bg-slate-800 px-2 rounded-full text-xs text-slate-400">{counts.discarded}</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 120 }}>
        <View className="px-4 py-6">
          <View className="flex-col gap-4 mb-6">
            <View className="flex-row bg-slate-800 p-1 rounded-lg">
              <Pressable onPress={() => setActiveFilter('all')} className={`px-3 py-1.5 rounded-md ${activeFilter === 'all' ? 'bg-slate-700' : ''}`}>
                <Text className={activeFilter === 'all' ? 'text-white text-xs font-medium' : 'text-slate-400 text-xs font-medium'}>Todo</Text>
              </Pressable>
              <Pressable onPress={() => setActiveFilter(MediaType.MOVIE)} className={`px-3 py-1.5 rounded-md flex-row items-center gap-1 ${activeFilter === MediaType.MOVIE ? 'bg-slate-700' : ''}`}>
                <Film size={12} color={activeFilter === MediaType.MOVIE ? '#fff' : '#94a3b8'} />
                <Text className={activeFilter === MediaType.MOVIE ? 'text-white text-xs font-medium' : 'text-slate-400 text-xs font-medium'}>Pelis</Text>
              </Pressable>
              <Pressable onPress={() => setActiveFilter(MediaType.SERIES)} className={`px-3 py-1.5 rounded-md flex-row items-center gap-1 ${activeFilter === MediaType.SERIES ? 'bg-slate-700' : ''}`}>
                <Tv size={12} color={activeFilter === MediaType.SERIES ? '#fff' : '#94a3b8'} />
                <Text className={activeFilter === MediaType.SERIES ? 'text-white text-xs font-medium' : 'text-slate-400 text-xs font-medium'}>Series</Text>
              </Pressable>
            </View>
            <View className="flex-row gap-2">
              <Pressable onPress={() => setUserFilter(userFilter === USERS[0].id ? null : USERS[0].id)} className={`px-3 py-1.5 rounded-full border ${userFilter === USERS[0].id ? 'bg-indigo-500/20 border-indigo-500' : 'bg-slate-800 border-transparent'}`}>
                <Text className={userFilter === USERS[0].id ? 'text-indigo-300 text-xs font-bold' : 'text-slate-400 text-xs font-bold'}>{USERS[0].name}</Text>
              </Pressable>
              <Pressable onPress={() => setUserFilter(userFilter === USERS[1].id ? null : USERS[1].id)} className={`px-3 py-1.5 rounded-full border ${userFilter === USERS[1].id ? 'bg-pink-500/20 border-pink-500' : 'bg-slate-800 border-transparent'}`}>
                <Text className={userFilter === USERS[1].id ? 'text-pink-300 text-xs font-bold' : 'text-slate-400 text-xs font-bold'}>{USERS[1].name}</Text>
              </Pressable>
            </View>
          </View>

          {filteredItems.length === 0 ? (
            <View className="items-center justify-center py-20">
              <ListFilter size={48} color="#64748b" />
              <Text className="text-lg text-slate-500 mt-4">No hay nada por aquí.</Text>
            </View>
          ) : (
            <FlatList
              data={filteredItems}
              key={columnCount}
              keyExtractor={(item) => item.id}
              numColumns={columnCount}
              columnWrapperStyle={{ gap: 12, marginBottom: 12 }}
              renderItem={({ item }) => (
                <MediaCard
                  item={item}
                  users={USERS}
                  onClick={(i) => setSelectedItem(i)}
                  columns={columnCount}
                />
              )}
            />
          )}
        </View>
      </ScrollView>

      <WhisperChat items={items} users={USERS} onAdd={handleAddItem} onUpdate={handleUpdateItem} />
      <Pressable onPress={() => setIsSearchOpen(true)} className="absolute bottom-6 left-6 bg-indigo-600 p-4 rounded-full shadow-2xl">
        <Plus size={28} color="#fff" />
      </Pressable>

      <WatchedModal isOpen={!!selectedItem} item={selectedItem} users={USERS} onClose={() => setSelectedItem(null)} onUpdateItem={handleUpdateItem} onUpdateStatus={() => { }} onDelete={handleDelete} />
      <SearchOverlay isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} onAdd={(result) => handleAddItem(result)} />
    </View>
  );
};

export default App;
