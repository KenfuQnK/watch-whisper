import React, { useState, useEffect } from 'react';
import { MediaItem, User, MediaType, Platform, WatchInfo, CollectionType } from '../types';
import Avatar from './Avatar';
import { X, Check, Trash2, ChevronDown, ChevronRight, Film, Tv, MonitorPlay, Calendar, CheckCircle2, ThumbsUp, ThumbsDown, Star, Youtube, ExternalLink, Ticket, Download, Zap, Wifi, Loader2, Sparkles, Ban } from 'lucide-react';

interface WatchedModalProps {
  item: MediaItem | null;
  users: User[];
  isOpen: boolean;
  onClose: () => void;
  // NOTE: onUpdateStatus is deprecated in favor of onUpdateItem handling everything on save
  onUpdateStatus: (userId: string, changes: any) => void;
  onUpdateItem: (itemId: string, changes: Partial<MediaItem>) => void;
  onDelete: (itemId: string) => void;
}

const PLATFORM_OPTIONS: { name: string; color: string; icon: React.ReactNode }[] = [
    { name: 'Netflix', color: 'bg-red-600', icon: <span className="font-bold text-lg">N</span> },
    { name: 'HBO', color: 'bg-purple-900', icon: <span className="font-bold text-lg">HBO</span> },
    { name: 'Disney+', color: 'bg-blue-600', icon: <span className="font-bold text-lg">D+</span> },
    { name: 'Prime', color: 'bg-sky-500', icon: <span className="font-bold text-lg">Prime</span> },
    { name: 'AppleTV', color: 'bg-gray-200 text-black', icon: <span className="font-bold text-lg"></span> },
    { name: 'Stremio', color: 'bg-indigo-500', icon: <Zap /> },
    { name: 'Torrent', color: 'bg-green-600', icon: <Download /> },
    { name: 'Online', color: 'bg-orange-500', icon: <Wifi /> },
    { name: 'Cine', color: 'bg-yellow-500', icon: <Ticket /> },
];

const WatchedModal: React.FC<WatchedModalProps> = ({ 
  item: propItem, 
  users, 
  isOpen, 
  onClose, 
  onUpdateItem,
  onDelete
}) => {
  // --- LOCAL STATE (Prevents DB flickering) ---
  const [localItem, setLocalItem] = useState<MediaItem | null>(null);
  
  // UI States
  const [openSeasons, setOpenSeasons] = useState<Record<number, boolean>>({1: true});
  const [imageState, setImageState] = useState<0 | 1 | 2>(0);
  const [isPlayingTrailer, setIsPlayingTrailer] = useState(false);
  const [isEditingTrailer, setIsEditingTrailer] = useState(false);
  const [trailerInput, setTrailerInput] = useState('');
  const [showPlatformSelector, setShowPlatformSelector] = useState(false);

  // Initialize Local State when Modal Opens or Prop Item ID changes (navigating between items)
  useEffect(() => {
    if (propItem) {
        // Deep copy to ensure we don't mutate prop references
        setLocalItem(JSON.parse(JSON.stringify(propItem)));
        
        // Reset UI states
        setImageState(0);
        setOpenSeasons({1: true});
        setIsPlayingTrailer(false);
        setIsEditingTrailer(false);
        setTrailerInput(propItem.trailerUrl || '');
        setShowPlatformSelector(false);
    } else {
        setLocalItem(null);
    }
  }, [propItem?.id, isOpen]); // Only update if ID changes or modal re-opens

  // Real-time update from backend (for enrichment status)
  useEffect(() => {
      if (propItem && localItem && propItem.id === localItem.id) {
          // If the backend has enriched the item, update our local view immediately
          // IMPORTANT: Check individual fields to update dynamically without overwriting user edits in progress
          // Actually, since enrich is a background process that happens ONCE, we can just sync if 'isEnriched' changes
          if (propItem.isEnriched && !localItem.isEnriched) {
             setLocalItem(prev => {
                 if (!prev) return null;
                 return {
                     ...prev,
                     isEnriched: true,
                     title: propItem.title !== prev.title ? propItem.title : prev.title,
                     originalTitle: propItem.originalTitle,
                     description: propItem.description !== prev.description ? propItem.description : prev.description,
                     trailerUrl: propItem.trailerUrl !== prev.trailerUrl ? propItem.trailerUrl : prev.trailerUrl
                 }
             });
          }
      }
  }, [propItem]);

  // --- SAVE & CLOSE LOGIC ---
  const handleSaveAndClose = () => {
      if (localItem && propItem) {
          // Check if there are actual changes? (Optional optimization, but we'll just save)
          // Also need to recalculate collectionId based on watch status
          const updatedUserStatus = localItem.userStatus;
          const isStarted = Object.values(updatedUserStatus).some((s: WatchInfo) => s.watched || (s.watchedEpisodes && s.watchedEpisodes.length > 0));
          const newCollectionId = isStarted ? CollectionType.WATCHED : CollectionType.WATCHLIST;
          
          onUpdateItem(localItem.id, {
              ...localItem,
              collectionId: newCollectionId
          });
      }
      onClose();
  };

  if (!isOpen || !localItem) return null;

  // --- HANDLERS (Mutate Local State) ---

  const updateLocalItem = (changes: Partial<MediaItem>) => {
      setLocalItem(prev => prev ? ({ ...prev, ...changes }) : null);
  };

  const updateLocalUserStatus = (userId: string, changes: Partial<WatchInfo>) => {
      setLocalItem(prev => {
          if (!prev) return null;
          const currentStatus = prev.userStatus[userId] || { watched: false, watchedEpisodes: [] };
          const newStatus = { ...currentStatus, ...changes };
          
          // Movie date logic
          if (prev.type === MediaType.MOVIE) {
              if (changes.watched === true && !currentStatus.date) newStatus.date = Date.now();
              if (changes.watched === false) newStatus.date = undefined;
          }

          return {
              ...prev,
              userStatus: {
                  ...prev.userStatus,
                  [userId]: newStatus
              }
          };
      });
  };

  const handleImageError = () => {
    if (imageState === 0 && localItem.backupPosterUrl) {
        setImageState(1);
    } else {
        setImageState(2);
    }
  };

  let currentSrc = localItem.posterUrl;
  if (imageState === 1 && localItem.backupPosterUrl) currentSrc = localItem.backupPosterUrl;

  const toggleSeason = (seasonNum: number) => {
    setOpenSeasons(prev => ({...prev, [seasonNum]: !prev[seasonNum]}));
  };

  // --- WATCH STATUS LOGIC (Local) ---

  const handleToggleSeason = (e: React.MouseEvent, userId: string, seasonNum: number, episodeCount: number) => {
    e.stopPropagation();
    const userStatus = localItem.userStatus[userId] || { watched: false, watchedEpisodes: [] };
    const currentEps = userStatus.watchedEpisodes || [];
    
    const seasonEpisodeKeys = Array.from({ length: episodeCount }, (_, i) => `S${seasonNum}_E${i + 1}`);
    const allWatched = seasonEpisodeKeys.every(key => currentEps.includes(key));

    let newEps;
    if (allWatched) {
        newEps = currentEps.filter(ep => !seasonEpisodeKeys.includes(ep));
    } else {
        const uniqueEps = new Set([...currentEps, ...seasonEpisodeKeys]);
        newEps = Array.from(uniqueEps);
    }

    updateLocalUserStatus(userId, { watchedEpisodes: newEps });
  };

  const handleToggleEpisode = (userId: string, season: number, episode: number) => {
      const epKey = `S${season}_E${episode}`;
      const userStatus = localItem.userStatus[userId] || { watched: false, watchedEpisodes: [] };
      const currentEps = userStatus.watchedEpisodes || [];
      
      let newEps;
      if (currentEps.includes(epKey)) {
          newEps = currentEps.filter(e => e !== epKey);
      } else {
          newEps = [...currentEps, epKey];
      }

      updateLocalUserStatus(userId, { watchedEpisodes: newEps });
  };

  // --- TRAILER HELPERS ---
  const getYoutubeEmbedUrl = (url: string) => {
      const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
      const match = url.match(regExp);
      const id = (match && match[2].length === 11) ? match[2] : null;
      return id ? `https://www.youtube.com/embed/${id}?autoplay=1` : null;
  };

  const handleSaveTrailer = () => {
      updateLocalItem({ trailerUrl: trailerInput });
      setIsEditingTrailer(false);
      if (trailerInput && getYoutubeEmbedUrl(trailerInput)) {
          setIsPlayingTrailer(true);
      }
  };

  // --- PLATFORM HELPER ---
  const togglePlatform = (pName: string) => {
      const current = localItem.platform || [];
      if (current.includes(pName)) {
          updateLocalItem({ platform: current.filter(p => p !== pName) });
      } else {
          updateLocalItem({ platform: [...current, pName] });
      }
  };

  // --- RATING HELPER ---
  const RatingButton = ({ value, icon, activeColor, label }: { value: number, icon: React.ReactNode, activeColor: string, label?: string }) => {
      const isSelected = localItem.rating === value;
      return (
          <button
              onClick={() => updateLocalItem({ rating: isSelected ? undefined : value })}
              className={`flex-1 flex flex-col items-center justify-center py-2 rounded-lg transition-all border border-slate-700/50 ${isSelected ? activeColor + ' bg-opacity-20 text-white' : 'hover:bg-slate-700 text-slate-500 hover:text-slate-300'}`}
              style={{ backgroundColor: isSelected ? 'rgba(255,255,255,0.1)' : undefined }}
              title={label}
          >
              <div className={`${isSelected ? '' : 'opacity-70'}`}>
                {icon}
              </div>
          </button>
      )
  };

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop closes and saves */}
      <div 
        className="absolute inset-0 bg-slate-900/90 backdrop-blur-sm transition-opacity"
        onClick={handleSaveAndClose}
      />

      <div className="relative bg-slate-800 rounded-2xl shadow-2xl w-full max-w-5xl overflow-hidden border border-slate-700 transform transition-all flex flex-col max-h-[90vh]">
        
        {/* Header Image or Trailer */}
        <div className="h-40 lg:h-52 w-full relative shrink-0 group bg-slate-900">
           {isPlayingTrailer && localItem.trailerUrl ? (
               <div className="w-full h-full bg-black relative">
                   <iframe 
                        className="w-full h-full"
                        src={getYoutubeEmbedUrl(localItem.trailerUrl) || ''}
                        title="Trailer"
                        frameBorder="0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                   ></iframe>
                   <button 
                       onClick={() => setIsPlayingTrailer(false)}
                       className="absolute top-3 right-3 p-2 bg-black/60 hover:bg-black/80 rounded-full text-white transition-colors"
                   >
                       <X size={20} />
                   </button>
               </div>
           ) : (
             <>
               {imageState < 2 && currentSrc ? (
                  <img 
                    src={currentSrc} 
                    alt={localItem.title} 
                    className="w-full h-full object-cover opacity-60"
                    onError={handleImageError}
                  />
               ) : (
                 <div className="w-full h-full flex items-center justify-center bg-slate-900 opacity-60">
                     <div className="text-4xl opacity-50">
                         {localItem.type === MediaType.MOVIE ? <Film size={64} /> : <Tv size={64} />}
                     </div>
                 </div>
               )}
              
              <div className="absolute inset-0 bg-gradient-to-b from-transparent to-slate-800" />
              <button 
                onClick={handleSaveAndClose}
                className="absolute top-3 right-3 p-2 bg-black/40 hover:bg-black/60 rounded-full text-white transition-colors z-10"
              >
                <X size={20} />
              </button>

              {/* Play Trailer Button Area */}
              <div className="absolute bottom-4 left-6 z-10 flex gap-2">
                 {localItem.trailerUrl ? (
                    <button 
                        onClick={() => setIsPlayingTrailer(true)}
                        className="bg-red-600/90 hover:bg-red-600 text-white px-4 py-1.5 rounded-full text-xs font-bold flex items-center gap-2 backdrop-blur shadow-lg transition-transform hover:scale-105"
                    >
                        <Youtube size={16} /> Ver Trailer
                    </button>
                 ) : (
                    // Logic: If NO trailer, check if AI is still working
                    !localItem.isEnriched ? (
                        <div className="bg-indigo-600/50 text-indigo-100 px-4 py-1.5 rounded-full text-xs font-bold flex items-center gap-2 backdrop-blur border border-indigo-500/30 animate-pulse">
                            <Loader2 size={14} className="animate-spin" /> Buscando trailer...
                        </div>
                    ) : (
                        <button 
                            onClick={() => setIsEditingTrailer(true)}
                            className="bg-slate-700/80 hover:bg-slate-600 text-slate-200 px-4 py-1.5 rounded-full text-xs font-bold flex items-center gap-2 backdrop-blur border border-slate-600 transition-colors"
                        >
                            <Youtube size={16} /> Añadir Trailer
                        </button>
                    )
                 )}
              </div>
             </>
           )}
        </div>

        {/* Body - Split layout for LG screens */}
        <div className="p-6 -mt-2 relative z-10 flex-1 overflow-y-auto custom-scrollbar">
          
          {/* Main Grid Container */}
          <div className="lg:grid lg:grid-cols-12 lg:gap-8">
            
            {/* COLUMN 1: Info & Controls */}
            <div className="lg:col-span-5 space-y-6 mb-8 lg:mb-0">
                <div>
                    <div className="flex gap-2 mb-2 items-center">
                        <span className="bg-indigo-500/80 backdrop-blur text-xs px-2 py-0.5 rounded text-white font-bold uppercase">
                            {localItem.type === MediaType.MOVIE ? 'Película' : 'Serie'}
                        </span>
                        <span className="bg-slate-700/80 backdrop-blur text-xs px-2 py-0.5 rounded text-slate-300">
                            {localItem.year}
                        </span>
                        {!localItem.isEnriched && (
                             <span className="text-[10px] text-indigo-400 flex items-center gap-1 animate-pulse">
                                 <Sparkles size={10} /> Analizando...
                             </span>
                        )}
                    </div>
                    <div className="flex items-start justify-between gap-2">
                         <h2 className="text-3xl font-bold text-white mb-2 leading-tight">{localItem.title}</h2>
                         {(localItem.trailerUrl || isEditingTrailer || localItem.isEnriched) && (
                             <button onClick={() => setIsEditingTrailer(!isEditingTrailer)} className="text-slate-500 hover:text-white p-1" title="Editar URL Trailer">
                                 <ExternalLink size={14} />
                             </button>
                         )}
                    </div>
                    
                    {/* Trailer Input Edit Mode */}
                    {isEditingTrailer && (
                        <div className="mb-4 bg-slate-900 p-2 rounded-lg border border-slate-700 animate-in fade-in slide-in-from-top-2">
                             <input 
                                type="text" 
                                value={trailerInput}
                                onChange={(e) => setTrailerInput(e.target.value)}
                                placeholder="Pega aquí link de Youtube..."
                                className="w-full bg-slate-800 text-xs text-white p-2 rounded mb-2 border border-slate-600 focus:border-indigo-500 outline-none"
                             />
                             <div className="flex justify-end gap-2">
                                 <button onClick={() => setIsEditingTrailer(false)} className="text-xs text-slate-400 hover:text-white px-2">Cancelar</button>
                                 <button onClick={handleSaveTrailer} className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1 rounded font-bold">OK</button>
                             </div>
                        </div>
                    )}

                    <p className="text-slate-300 text-sm leading-relaxed">
                        {localItem.description}
                        {!localItem.isEnriched && !localItem.description && (
                            <span className="italic opacity-50 block mt-2">Buscando sinopsis en español...</span>
                        )}
                    </p>
                </div>

                {/* Rating System */}
                <div className="bg-slate-900/40 p-3 rounded-xl border border-slate-700/50">
                    <label className="text-[10px] text-slate-400 uppercase font-bold mb-2 block">Valoración</label>
                    <div className="flex gap-2">
                        <RatingButton value={9} activeColor="text-red-600" icon={<Ban size={20} />} label="Descartado" />
                        <RatingButton value={1} activeColor="text-red-500" icon={<ThumbsDown size={20} />} label="Mala" />
                        <RatingButton value={2} activeColor="text-blue-400" icon={<ThumbsUp size={20} />} label="Buena" />
                        <RatingButton 
                            value={3} 
                            activeColor="text-pink-500" 
                            icon={
                                <div className="flex -space-x-2">
                                    <ThumbsUp size={18} className="transform -rotate-12" />
                                    <ThumbsUp size={18} className="transform rotate-12" />
                                </div>
                            } 
                            label="Me encanta" 
                        />
                        <RatingButton value={4} activeColor="text-yellow-400" icon={<Star size={20} fill="currentColor" />} label="Obra Maestra" />
                    </div>
                </div>

                {/* Controls: Platform & Date */}
                <div className="grid grid-cols-2 gap-4 bg-slate-900/40 p-3 rounded-xl border border-slate-700/50 relative">
                    {/* Platform Selector */}
                    <div>
                        <label className="text-[10px] text-slate-400 uppercase font-bold mb-1 flex items-center gap-1">
                            <MonitorPlay size={10} /> Plataformas
                        </label>
                        <button 
                            onClick={() => setShowPlatformSelector(true)}
                            className="w-full bg-slate-800 border border-slate-700 text-xs text-left text-white rounded-lg py-2 px-3 flex justify-between items-center hover:bg-slate-700 transition-colors"
                        >
                            <span className="truncate">
                                {localItem.platform && localItem.platform.length > 0 
                                    ? localItem.platform.join(', ') 
                                    : 'Seleccionar...'}
                            </span>
                            <ChevronDown size={12} className="text-slate-400" />
                        </button>
                    </div>

                    <div>
                        <label className="text-[10px] text-slate-400 uppercase font-bold mb-1 flex items-center gap-1">
                            <Calendar size={10} /> Estreno
                        </label>
                        <input 
                            type="date" 
                            value={localItem.releaseDate || ''}
                            onChange={(e) => updateLocalItem({ releaseDate: e.target.value })}
                            className="w-full bg-slate-800 border border-slate-700 text-xs text-white rounded-lg py-1.5 px-2 focus:outline-none focus:border-indigo-500"
                        />
                    </div>
                </div>

                {/* Delete Button (Visible on Desktop here) */}
                <div className="hidden lg:block pt-4">
                    <button 
                        onClick={() => { onDelete(localItem.id); onClose(); }}
                        className="flex items-center gap-2 text-red-400 text-xs hover:text-red-300 hover:bg-red-400/10 px-3 py-2 rounded-lg transition-colors w-full justify-center"
                    >
                        <Trash2 size={14} /> Eliminar Título
                    </button>
                </div>
            </div>

            {/* COLUMN 2: Episodes / Status */}
            <div className="lg:col-span-7 space-y-6">
                
                {/* MOVIE LOGIC */}
                {localItem.type === MediaType.MOVIE && (
                    <div className="bg-slate-900/30 rounded-xl p-4 border border-slate-700/30">
                        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest border-b border-slate-700 pb-2 mb-4">
                        Estado de Visualización
                        </h3>
                        <div className="space-y-3">
                            {users.map(user => {
                                const status = localItem.userStatus[user.id] || { watched: false };
                                return (
                                <div key={user.id} className="bg-slate-800 rounded-xl p-4 border border-slate-700/50 flex items-center justify-between shadow-sm">
                                    <div className="flex items-center gap-3">
                                        <Avatar user={user} size="md" selected={status.watched} onClick={() => updateLocalUserStatus(user.id, { watched: !status.watched })} />
                                        <div className="flex flex-col">
                                            <span className="font-medium text-white">{user.name}</span>
                                            {status.watched && status.date && (
                                                <span className="text-[10px] text-slate-400">Visto el {new Date(status.date).toLocaleDateString('es-ES')}</span>
                                            )}
                                            {status.watched && !status.date && <span className="text-[10px] text-green-400 font-bold">Recién marcado</span>}
                                        </div>
                                    </div>
                                    <button 
                                        onClick={() => updateLocalUserStatus(user.id, { watched: !status.watched })}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${status.watched ? 'bg-green-500/20 text-green-400' : 'bg-slate-700 text-slate-400'}`}
                                    >
                                        {status.watched ? 'VISTO' : 'NO VISTO'}
                                    </button>
                                </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* SERIES LOGIC */}
                {localItem.type === MediaType.SERIES && (
                    <div className="space-y-4">
                    <div className="flex justify-between items-end border-b border-slate-700 pb-2 sticky top-0 bg-slate-800/95 backdrop-blur z-20 pt-2">
                            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                                Temporadas y Capítulos
                            </h3>
                            <div className="flex gap-2">
                                {users.map(u => (
                                    <div key={u.id} className="flex items-center gap-1">
                                        <div className="w-2 h-2 rounded-full" style={{background: u.color}}></div>
                                        <span className="text-[10px] text-slate-400 uppercase">{u.name}</span>
                                    </div>
                                ))}
                            </div>
                    </div>

                    {(!localItem.seasons || localItem.seasons.length === 0) ? (
                        <div className="text-center py-6 bg-slate-800/50 rounded-xl border border-dashed border-slate-700">
                            <p className="text-slate-400 text-sm mb-1">Falta información de episodios</p>
                            <p className="text-slate-600 text-xs">Añade los episodios manualmente o busca de nuevo.</p>
                        </div>
                    ) : (
                        localItem.seasons.map(season => {
                            const isOpen = openSeasons[season.seasonNumber];
                            const episodeCount = season.episodeCount;
                            const seasonKeys = Array.from({ length: episodeCount }, (_, i) => `S${season.seasonNumber}_E${i + 1}`);

                            return (
                                <div key={season.seasonNumber} className="bg-slate-900/50 rounded-xl overflow-hidden border border-slate-700/50">
                                    <div 
                                        onClick={() => toggleSeason(season.seasonNumber)}
                                        className="w-full flex items-center justify-between p-3 hover:bg-slate-800 transition-colors cursor-pointer"
                                    >
                                        <div className="flex items-center gap-2">
                                            {isOpen ? <ChevronDown size={16} className="text-white" /> : <ChevronRight size={16} className="text-white" />}
                                            <div>
                                                <span className="font-bold text-sm text-white block leading-none">
                                                    Temporada {season.seasonNumber}
                                                </span>
                                                <span className="text-[10px] text-slate-500 leading-none">{season.episodeCount} episodios</span>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-3">
                                                {users.map(u => {
                                                    const uStatus = localItem.userStatus[u.id];
                                                    const watchedCount = uStatus?.watchedEpisodes?.filter(ep => seasonKeys.includes(ep)).length || 0;
                                                    const isFull = watchedCount === episodeCount;
                                                    const isNone = watchedCount === 0;

                                                    return (
                                                        <button
                                                            key={u.id}
                                                            onClick={(e) => handleToggleSeason(e, u.id, season.seasonNumber, season.episodeCount)}
                                                            className={`w-7 h-7 rounded-full flex items-center justify-center transition-all border ${isFull ? 'bg-opacity-20' : 'bg-transparent'}`}
                                                            style={{ 
                                                                backgroundColor: isFull ? u.color : undefined,
                                                                borderColor: isFull ? u.color : 'rgba(148, 163, 184, 0.3)',
                                                                color: isFull ? u.color : '#64748b'
                                                            }}
                                                            title={`Marcar todos para ${u.name}`}
                                                        >
                                                            {isFull ? (
                                                                <Check size={14} className="text-white" />
                                                            ) : (
                                                                <CheckCircle2 size={14} className={!isNone ? 'text-white' : ''} style={{ opacity: isNone ? 0.3 : 1 }} />
                                                            )}
                                                        </button>
                                                    )
                                                })}
                                        </div>
                                    </div>
                                    
                                    {isOpen && (
                                        <div className="p-2 space-y-1 bg-black/20 border-t border-slate-800">
                                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 gap-1">
                                                {Array.from({length: season.episodeCount}).map((_, i) => {
                                                    const epNum = i + 1;
                                                    const epKey = `S${season.seasonNumber}_E${epNum}`;
                                                    
                                                    return (
                                                        <div key={epNum} className="flex items-center justify-between p-2 rounded hover:bg-white/5 group bg-slate-800/30">
                                                            <span className="text-xs text-slate-300 font-mono">E{epNum}</span>
                                                            <div className="flex items-center gap-2">
                                                                {users.map(user => {
                                                                    const userStatus = localItem.userStatus[user.id];
                                                                    const isWatched = userStatus?.watchedEpisodes?.includes(epKey);
                                                                    
                                                                    return (
                                                                        <button
                                                                            key={user.id}
                                                                            onClick={() => handleToggleEpisode(user.id, season.seasonNumber, epNum)}
                                                                            className={`w-5 h-5 rounded-full border flex items-center justify-center transition-all ${isWatched ? 'border-transparent' : 'border-slate-600 bg-transparent opacity-30 hover:opacity-100'}`}
                                                                            style={{ backgroundColor: isWatched ? user.color : undefined }}
                                                                        >
                                                                            {isWatched && <Check size={10} className="text-black/50" />}
                                                                        </button>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                    </div>
                )}
            </div>
          </div>
        </div>

        {/* Footer (Mobile only logic removed, standardized footer) */}
        <div className="p-4 bg-slate-800 border-t border-slate-700 flex justify-between items-center shrink-0 z-20">
             <button 
               onClick={() => {
                 onDelete(localItem.id);
                 onClose();
               }}
               className="lg:hidden flex items-center gap-2 text-red-400 text-xs hover:text-red-300 hover:bg-red-400/10 px-3 py-2 rounded-lg transition-colors"
             >
               <Trash2 size={14} /> Eliminar
             </button>
             
             {/* SAVE & CLOSE BUTTON */}
             <div className="flex w-full justify-end">
                <button 
                    onClick={handleSaveAndClose}
                    className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2 rounded-lg font-bold text-sm transition-colors shadow-lg shadow-indigo-500/20"
                >
                    <Check size={16} /> Guardar y Cerrar
                </button>
             </div>
        </div>
      </div>
    </div>
    
    {/* CENTERED PLATFORM MODAL OVERLAY */}
    {showPlatformSelector && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in">
             <div className="w-80 bg-slate-800 border border-slate-600 rounded-xl shadow-2xl p-4 animate-in zoom-in-95">
                <div className="flex justify-between items-center mb-4 pb-2 border-b border-slate-700">
                    <span className="text-sm font-bold text-white">Elige plataformas:</span>
                    <button onClick={() => setShowPlatformSelector(false)} className="text-slate-400 hover:text-white"><X size={16}/></button>
                </div>
                <div className="grid grid-cols-3 gap-3">
                    {PLATFORM_OPTIONS.map(opt => {
                        const isSelected = localItem.platform?.includes(opt.name);
                        return (
                            <button 
                                key={opt.name}
                                onClick={() => togglePlatform(opt.name)}
                                className={`flex flex-col items-center justify-center p-3 rounded-xl transition-all aspect-square border-2 ${isSelected ? 'border-white/50 ' + opt.color + ' text-white shadow-lg scale-105' : 'border-transparent bg-slate-700 text-slate-400 hover:bg-slate-600'}`}
                            >
                                <div className="mb-2 transform scale-125">{opt.icon}</div>
                                <span className="text-[10px] font-bold leading-none">{opt.name}</span>
                                {isSelected && <div className="absolute top-1 right-1 bg-white text-black rounded-full p-0.5"><Check size={8} /></div>}
                            </button>
                        )
                    })}
                </div>
                <button 
                    onClick={() => setShowPlatformSelector(false)} 
                    className="w-full mt-4 bg-slate-700 hover:bg-slate-600 text-white py-2 rounded-lg font-bold text-xs"
                >
                    Listo
                </button>
             </div>
        </div>
    )}
    </>
  );
};

export default WatchedModal;