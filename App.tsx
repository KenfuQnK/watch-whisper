import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Plus, ListFilter, Film, Tv, Download, Upload, Filter, Calendar } from 'lucide-react';
import { MediaItem, User, MediaType, CollectionType, SearchResult, WatchInfo } from './types';
import MediaCard from './components/MediaCard';
import WatchedModal from './components/WatchedModal';
import SearchOverlay from './components/SearchOverlay';
import Avatar from './components/Avatar';
import { getSeriesDetails } from './services/gemini';

// --- CONFIG ---
const STORAGE_KEY = 'duowatch_data_v2';

const USERS: User[] = [
  { id: 'u1', name: 'Jesús', avatar: 'https://picsum.photos/seed/jesus/200', color: '#6366f1' }, // Indigo
  { id: 'u2', name: 'Julia', avatar: 'https://picsum.photos/seed/julia/200', color: '#ec4899' }, // Pink
];

// Define UI Tabs (Computed, not stored directly as CollectionType)
type UiTab = 'pending' | 'inprogress' | 'finished';

const App: React.FC = () => {
  // Initialize state from LocalStorage or Default
  const [items, setItems] = useState<MediaItem[]>(() => {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            return JSON.parse(saved);
        }
    } catch (e) {
        console.error("Error loading localStorage", e);
    }
    return []; // Start empty if nothing saved
  });

  const [activeTab, setActiveTab] = useState<UiTab>('pending');
  const [activeFilter, setActiveFilter] = useState<'all' | MediaType>('all');
  const [userFilter, setUserFilter] = useState<string | null>(null); // ID of the user to filter by
  
  // Modal States
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isEnriching, setIsEnriching] = useState(false);
  
  // File Input Ref for Import
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Persistence Effect
  useEffect(() => {
     localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items]);

  // --- HELPERS FOR STATUS ---
  const getStatusCounts = (item: MediaItem) => {
      let startedCount = 0;
      let finishedCount = 0;

      USERS.forEach(user => {
          const status = item.userStatus[user.id];
          if (!status) return;

          if (item.type === MediaType.MOVIE) {
              if (status.watched) {
                  startedCount++;
                  finishedCount++;
              }
          } else {
              // Series
              const epCount = status.watchedEpisodes?.length || 0;
              if (epCount > 0) startedCount++;
              // Simplified "finished" logic for series (approximate)
              // If we have seasons data, we could check strictly, but for now:
              // If they watched > 0 eps, they started.
              // We consider "finished" if manually marked or if logic implies (hard for series without total eps)
              // For the sake of "A Medias" tab, we'll check if everyone has started/interacted.
              // To enable "Terminados" tab for series properly without checking every episode:
              // Let's assume for series: If they watched something, it's In Progress. 
              // *Ideally* users should mark "Whole series watched", but currently we track episodes.
              // Let's rely on: If ALL users have watched AT LEAST 1 episode -> Potentially finished/in progress.
              // Wait, the prompt says "A medias cuando solo uno de los dos la haya visto".
              // So:
              // Finished = All users have watched (Movie) or have > 0 eps (Series).
              // A Medias = Only 1 user has watched/started.
              if (epCount > 0) finishedCount++; 
          }
      });
      return { startedCount, finishedCount };
  };

  // --- FILTERING LOGIC ---
  const filteredItems = useMemo(() => {
    return items.filter(item => {
        const { startedCount, finishedCount } = getStatusCounts(item);
        const totalUsers = USERS.length;

        // 1. Tab Logic
        if (activeTab === 'pending') {
            // No one has started it
            if (startedCount > 0) return false;
        } else if (activeTab === 'inprogress') {
            // "A medias": At least one started, but NOT everyone has "finished" (or participated)
            // Strict interpretation of "Solo uno de los dos la haya visto":
            if (startedCount === 0) return false; // Pending
            if (finishedCount === totalUsers) return false; // Everyone saw it
        } else if (activeTab === 'finished') {
             // Everyone has seen it (or started the series)
             if (finishedCount < totalUsers) return false;
        }

        // 2. Type Filter
        if (activeFilter !== 'all' && item.type !== activeFilter) return false;

        // 3. User Filter
        if (userFilter) {
            // Show item if this specific user has interacted with it
            const s = item.userStatus[userFilter];
            const hasActivity = s && (s.watched || (s.watchedEpisodes && s.watchedEpisodes.length > 0));
            
            // In Pending tab, user filter might mean "Assigned to me"? 
            // For simplicity: In "Pending", we ignore user filter (shared list).
            // In "In Progress" / "Finished", we allow filtering.
            if (activeTab !== 'pending' && !hasActivity) return false;
        }

        return true;
    }).sort((a, b) => b.addedAt - a.addedAt);
  }, [items, activeTab, activeFilter, userFilter]);

  // Tab Counts for Badge
  const counts = useMemo(() => {
      let pending = 0, inprogress = 0, finished = 0;
      items.forEach(item => {
          const { startedCount, finishedCount } = getStatusCounts(item);
          if (startedCount === 0) pending++;
          else if (finishedCount === USERS.length) finished++;
          else inprogress++;
      });
      return { pending, inprogress, finished };
  }, [items]);

  const handleAddItem = async (result: SearchResult) => {
    if (items.some(i => i.title === result.title && i.year === result.year)) {
        alert("¡Ya tienes esto en tu lista!");
        return;
    }
    setIsEnriching(true);
    const enrichedResult = await getSeriesDetails(result);
    const newItem: MediaItem = {
      id: Date.now().toString(),
      ...enrichedResult,
      collectionId: CollectionType.WATCHLIST,
      addedAt: Date.now(),
      userStatus: {},
      seasons: enrichedResult.seasons || [],
      platform: '', // Default empty
      releaseDate: '' 
    };
    setItems(prev => [newItem, ...prev]);
    setIsEnriching(false);
  };

  // New Generic Update Handler
  const handleUpdateItem = (itemId: string, changes: Partial<MediaItem>) => {
      setItems(prev => prev.map(item => item.id === itemId ? { ...item, ...changes } : item));
      if (selectedItem && selectedItem.id === itemId) {
          setSelectedItem(prev => prev ? { ...prev, ...changes } : null);
      }
  };

  const handleUpdateStatus = (userId: string, changes: Partial<WatchInfo>) => {
    if (!selectedItem) return;

    setItems(prev => prev.map(item => {
      if (item.id === selectedItem.id) {
        const currentStatus = item.userStatus[userId] || { watched: false, watchedEpisodes: [] };
        const newStatus: WatchInfo = { ...currentStatus, ...changes };

        if (item.type === MediaType.MOVIE) {
             if (changes.watched === true && !currentStatus.date) newStatus.date = Date.now();
             if (changes.watched === false) newStatus.date = undefined;
        }

        const updatedUserStatus = { ...item.userStatus, [userId]: newStatus };
        
        // CollectionType field is less relevant now with UI Tabs, but we keep it for legacy/logic
        // Determine loosely if it's watched
        const isStarted = Object.values(updatedUserStatus).some((s: WatchInfo) => s.watched || (s.watchedEpisodes && s.watchedEpisodes.length > 0));
        const newCollectionId = isStarted ? CollectionType.WATCHED : CollectionType.WATCHLIST;

        const updatedItem = { 
            ...item, 
            userStatus: updatedUserStatus, 
            collectionId: newCollectionId 
        };
        
        setSelectedItem(updatedItem);
        return updatedItem;
      }
      return item;
    }));
  };

  const handleDelete = (itemId: string) => {
    setItems(prev => prev.filter(i => i.id !== itemId));
  };

  // --- BACKUP FUNCTIONS ---
  const handleExport = () => {
    const dataStr = JSON.stringify(items, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `duowatch_backup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleImportClick = () => fileInputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = event.target?.result as string;
        const parsed = JSON.parse(json);
        if (Array.isArray(parsed)) {
          if (confirm(`Se van a importar ${parsed.length} elementos. Esto sobrescribirá los datos actuales. ¿Estás seguro?`)) {
            setItems(parsed);
          }
        } else {
          alert("El archivo no tiene el formato correcto.");
        }
      } catch (err) {
        alert("Error al leer el archivo JSON.");
        console.error(err);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 pb-20">
      
      {/* Header */}
      <header className="sticky top-0 z-40 bg-slate-900/80 backdrop-blur-md border-b border-slate-800">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-500 to-pink-500 flex items-center justify-center font-bold text-white">
              D
            </div>
            <h1 className="text-xl font-bold tracking-tight">DuoWatch</h1>
          </div>

          <div className="flex items-center gap-4">
              <div className="flex items-center gap-1 bg-slate-800 rounded-lg p-1">
                 <button onClick={handleExport} className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-md transition-colors" title="Exportar"><Download size={18} /></button>
                 <button onClick={handleImportClick} className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-md transition-colors" title="Importar"><Upload size={18} /></button>
                 <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".json" />
              </div>
              <div className="h-6 w-px bg-slate-700 mx-2 hidden md:block"></div>
              <div className="flex gap-3">
                {USERS.map(u => (
                    <Avatar key={u.id} user={u} size="sm" className="border-slate-800 shadow-sm" />
                ))}
              </div>
          </div>
        </div>
        
        {/* Navigation Tabs (3 States) */}
        <div className="max-w-6xl mx-auto px-4 flex gap-6 overflow-x-auto no-scrollbar mt-2 md:mt-0">
          <button 
            onClick={() => setActiveTab('pending')}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'pending' ? 'border-indigo-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
          >
            Pendientes <span className="bg-slate-800 px-2 rounded-full text-xs text-slate-400">{counts.pending}</span>
          </button>
          <button 
            onClick={() => setActiveTab('inprogress')}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'inprogress' ? 'border-orange-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
          >
            A Medias <span className="bg-slate-800 px-2 rounded-full text-xs text-slate-400">{counts.inprogress}</span>
          </button>
          <button 
            onClick={() => setActiveTab('finished')}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'finished' ? 'border-green-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
          >
            Terminados <span className="bg-slate-800 px-2 rounded-full text-xs text-slate-400">{counts.finished}</span>
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

        {/* Global Loading Feedback */}
        {isEnriching && (
            <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 bg-indigo-600 px-4 py-2 rounded-full shadow-lg text-sm font-bold animate-pulse">
                Obteniendo datos...
            </div>
        )}

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
        onUpdateStatus={handleUpdateStatus}
        onUpdateItem={handleUpdateItem}
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