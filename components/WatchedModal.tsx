import React, { useState, useEffect } from 'react';
import { MediaItem, User, MediaType, Platform } from '../types';
import Avatar from './Avatar';
import { X, Check, Trash2, ChevronDown, ChevronRight, Film, Tv, MonitorPlay, Calendar, CheckCircle2, ThumbsUp, ThumbsDown, Star } from 'lucide-react';

interface WatchedModalProps {
  item: MediaItem | null;
  users: User[];
  isOpen: boolean;
  onClose: () => void;
  onUpdateStatus: (userId: string, changes: any) => void;
  onUpdateItem: (itemId: string, changes: Partial<MediaItem>) => void;
  onDelete: (itemId: string) => void;
}

const PLATFORMS: Platform[] = ['Netflix', 'HBO', 'Disney+', 'AppleTV', 'Prime', 'Stremio', 'Torrent', 'Online', 'Cine'];

const WatchedModal: React.FC<WatchedModalProps> = ({ 
  item, 
  users, 
  isOpen, 
  onClose, 
  onUpdateStatus,
  onUpdateItem,
  onDelete
}) => {
  const [openSeasons, setOpenSeasons] = useState<Record<number, boolean>>({1: true});
  const [imageState, setImageState] = useState<0 | 1 | 2>(0);

  // CORRECCIÓN: Solo reiniciamos el estado visual si cambia el ID del item (abrimos otra peli/serie).
  useEffect(() => {
    if (item?.id) {
        setImageState(0);
        setOpenSeasons({1: true});
    }
  }, [item?.id]);

  if (!isOpen || !item) return null;

  const handleImageError = () => {
    if (imageState === 0 && item.backupPosterUrl) {
        setImageState(1);
    } else {
        setImageState(2);
    }
  };

  let currentSrc = item.posterUrl;
  if (imageState === 1 && item.backupPosterUrl) currentSrc = item.backupPosterUrl;

  const toggleSeason = (seasonNum: number) => {
    setOpenSeasons(prev => ({...prev, [seasonNum]: !prev[seasonNum]}));
  };

  const handleToggleSeason = (e: React.MouseEvent, userId: string, seasonNum: number, episodeCount: number) => {
    e.stopPropagation();
    const userStatus = item.userStatus[userId] || { watched: false, watchedEpisodes: [] };
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

    onUpdateStatus(userId, { watchedEpisodes: newEps });
  };

  const handleToggleEpisode = (userId: string, season: number, episode: number) => {
      const epKey = `S${season}_E${episode}`;
      const userStatus = item.userStatus[userId] || { watched: false, watchedEpisodes: [] };
      const currentEps = userStatus.watchedEpisodes || [];
      
      let newEps;
      if (currentEps.includes(epKey)) {
          newEps = currentEps.filter(e => e !== epKey);
      } else {
          newEps = [...currentEps, epKey];
      }

      onUpdateStatus(userId, { watchedEpisodes: newEps });
  };

  // --- RATING HELPER ---
  const RatingButton = ({ value, icon, activeColor, label }: { value: number, icon: React.ReactNode, activeColor: string, label?: string }) => {
      const isSelected = item.rating === value;
      return (
          <button
              onClick={() => onUpdateItem(item.id, { rating: isSelected ? undefined : value })}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div 
        className="absolute inset-0 bg-slate-900/90 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      <div className="relative bg-slate-800 rounded-2xl shadow-2xl w-full max-w-5xl overflow-hidden border border-slate-700 transform transition-all flex flex-col max-h-[90vh]">
        
        {/* Header Image */}
        <div className="h-40 lg:h-52 w-full relative shrink-0 group bg-slate-900">
           {imageState < 2 && currentSrc ? (
              <img 
                src={currentSrc} 
                alt={item.title} 
                className="w-full h-full object-cover opacity-60"
                onError={handleImageError}
              />
           ) : (
             <div className="w-full h-full flex items-center justify-center bg-slate-900 opacity-60">
                 <div className="text-4xl opacity-50">
                     {item.type === MediaType.MOVIE ? <Film size={64} /> : <Tv size={64} />}
                 </div>
             </div>
           )}
          
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-slate-800" />
          <button 
            onClick={onClose}
            className="absolute top-3 right-3 p-2 bg-black/40 hover:bg-black/60 rounded-full text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body - Split layout for LG screens */}
        <div className="p-6 -mt-16 relative z-10 flex-1 overflow-y-auto custom-scrollbar">
          
          {/* Main Grid Container */}
          <div className="lg:grid lg:grid-cols-12 lg:gap-8">
            
            {/* COLUMN 1: Info & Controls */}
            <div className="lg:col-span-5 space-y-6 mb-8 lg:mb-0">
                <div>
                    <div className="flex gap-2 mb-2">
                        <span className="bg-indigo-500/80 backdrop-blur text-xs px-2 py-0.5 rounded text-white font-bold uppercase">
                            {item.type === MediaType.MOVIE ? 'Película' : 'Serie'}
                        </span>
                        <span className="bg-slate-700/80 backdrop-blur text-xs px-2 py-0.5 rounded text-slate-300">
                            {item.year}
                        </span>
                    </div>
                    <h2 className="text-3xl font-bold text-white mb-2 leading-tight">{item.title}</h2>
                    <p className="text-slate-300 text-sm leading-relaxed">{item.description}</p>
                </div>

                {/* Rating System */}
                <div className="bg-slate-900/40 p-3 rounded-xl border border-slate-700/50">
                    <label className="text-[10px] text-slate-400 uppercase font-bold mb-2 block">Valoración</label>
                    <div className="flex gap-2">
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
                <div className="grid grid-cols-2 gap-4 bg-slate-900/40 p-3 rounded-xl border border-slate-700/50">
                    <div>
                        <label className="text-[10px] text-slate-400 uppercase font-bold mb-1 flex items-center gap-1">
                            <MonitorPlay size={10} /> Plataforma
                        </label>
                        <div className="relative">
                            <select 
                                value={item.platform || ''}
                                onChange={(e) => onUpdateItem(item.id, { platform: e.target.value as Platform })}
                                className="w-full bg-slate-800 border border-slate-700 text-xs text-white rounded-lg py-1.5 pl-2 pr-6 appearance-none focus:outline-none focus:border-indigo-500"
                            >
                                <option value="">Seleccionar...</option>
                                {PLATFORMS.map(p => (
                                    <option key={p} value={p}>{p}</option>
                                ))}
                            </select>
                            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={12} />
                        </div>
                    </div>
                    <div>
                        <label className="text-[10px] text-slate-400 uppercase font-bold mb-1 flex items-center gap-1">
                            <Calendar size={10} /> Estreno
                        </label>
                        <input 
                            type="date" 
                            value={item.releaseDate || ''}
                            onChange={(e) => onUpdateItem(item.id, { releaseDate: e.target.value })}
                            className="w-full bg-slate-800 border border-slate-700 text-xs text-white rounded-lg py-1 px-2 focus:outline-none focus:border-indigo-500"
                        />
                    </div>
                </div>

                {/* Delete Button (Visible on Desktop here) */}
                <div className="hidden lg:block pt-4">
                    <button 
                        onClick={() => { onDelete(item.id); onClose(); }}
                        className="flex items-center gap-2 text-red-400 text-xs hover:text-red-300 hover:bg-red-400/10 px-3 py-2 rounded-lg transition-colors w-full justify-center"
                    >
                        <Trash2 size={14} /> Eliminar Título
                    </button>
                </div>
            </div>

            {/* COLUMN 2: Episodes / Status */}
            <div className="lg:col-span-7 space-y-6">
                
                {/* MOVIE LOGIC */}
                {item.type === MediaType.MOVIE && (
                    <div className="bg-slate-900/30 rounded-xl p-4 border border-slate-700/30">
                        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest border-b border-slate-700 pb-2 mb-4">
                        Estado de Visualización
                        </h3>
                        <div className="space-y-3">
                            {users.map(user => {
                                const status = item.userStatus[user.id] || { watched: false };
                                return (
                                <div key={user.id} className="bg-slate-800 rounded-xl p-4 border border-slate-700/50 flex items-center justify-between shadow-sm">
                                    <div className="flex items-center gap-3">
                                        <Avatar user={user} size="md" selected={status.watched} onClick={() => onUpdateStatus(user.id, { watched: !status.watched })} />
                                        <div className="flex flex-col">
                                            <span className="font-medium text-white">{user.name}</span>
                                            {status.watched && status.date && (
                                                <span className="text-[10px] text-slate-400">Visto el {new Date(status.date).toLocaleDateString('es-ES')}</span>
                                            )}
                                        </div>
                                    </div>
                                    <button 
                                        onClick={() => onUpdateStatus(user.id, { watched: !status.watched })}
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
                {item.type === MediaType.SERIES && (
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

                    {(!item.seasons || item.seasons.length === 0) ? (
                        <div className="text-center py-6 bg-slate-800/50 rounded-xl border border-dashed border-slate-700">
                            <p className="text-slate-400 text-sm mb-1">Falta información de episodios</p>
                            <p className="text-slate-600 text-xs">Añade los episodios manualmente o busca de nuevo.</p>
                        </div>
                    ) : (
                        item.seasons.map(season => {
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
                                                    const uStatus = item.userStatus[u.id];
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
                                                                    const userStatus = item.userStatus[user.id];
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

        {/* Footer (Only visible on small screens to save space on desktop since we have inline delete) */}
        <div className="p-4 bg-slate-800 border-t border-slate-700 flex justify-between items-center shrink-0 lg:hidden">
             <button 
               onClick={() => {
                 onDelete(item.id);
                 onClose();
               }}
               className="flex items-center gap-2 text-red-400 text-xs hover:text-red-300 hover:bg-red-400/10 px-3 py-2 rounded-lg transition-colors"
             >
               <Trash2 size={14} /> Eliminar
             </button>
             
             <button 
                onClick={onClose}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2 rounded-lg font-bold text-sm transition-colors shadow-lg shadow-indigo-500/20"
             >
                <Check size={16} /> Cerrar
             </button>
        </div>
        
        {/* Desktop Close Button (Floating) */}
        <div className="hidden lg:flex absolute bottom-6 right-6 z-20">
             <button 
                onClick={onClose}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-3 rounded-xl font-bold text-base transition-colors shadow-xl shadow-indigo-900/50"
             >
                <Check size={20} /> Cerrar
             </button>
        </div>
      </div>
    </div>
  );
};

export default WatchedModal;