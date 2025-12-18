import React, { useState, useEffect } from 'react';
import { MediaItem, User, MediaType, CollectionType, WatchInfo } from '../types';
import Avatar from './Avatar';
import { X, Check, Trash2, ChevronDown, ChevronRight, Film, Tv, MonitorPlay, Calendar, CheckCircle2, ThumbsUp, ThumbsDown, Star, Youtube, ExternalLink, Ticket, Download, Zap, Wifi, Loader2, Sparkles, Ban } from 'lucide-react';

interface WatchedModalProps {
  item: MediaItem | null;
  users: User[];
  isOpen: boolean;
  onClose: () => void;
  onUpdateStatus: (userId: string, changes: any) => void;
  onUpdateItem: (itemId: string, changes: Partial<MediaItem>) => void;
  onDelete: (itemId: string) => void;
}

const PLATFORM_OPTIONS = [
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

const WatchedModal: React.FC<WatchedModalProps> = ({ item: propItem, users, isOpen, onClose, onUpdateItem, onDelete }) => {
  const [localItem, setLocalItem] = useState<MediaItem | null>(null);
  const [openSeasons, setOpenSeasons] = useState<Record<number, boolean>>({1: true});
  const [imageState, setImageState] = useState<0 | 1 | 2>(0);
  const [isPlayingTrailer, setIsPlayingTrailer] = useState(false);
  const [showPlatformSelector, setShowPlatformSelector] = useState(false);

  useEffect(() => {
    if (propItem) {
        setLocalItem(JSON.parse(JSON.stringify(propItem)));
        setImageState(0);
        setIsPlayingTrailer(false);
    } else { setLocalItem(null); }
  }, [propItem?.id, isOpen]);

  const handleSaveAndClose = () => {
      if (localItem) {
          const isStarted = Object.values(localItem.userStatus).some((s: any) => s.watched || (s.watchedEpisodes?.length > 0));
          onUpdateItem(localItem.id, { ...localItem, collectionId: isStarted ? CollectionType.WATCHED : CollectionType.WATCHLIST });
      }
      onClose();
  };

  if (!isOpen || !localItem) return null;

  const updateLocalItem = (changes: Partial<MediaItem>) => setLocalItem(prev => prev ? ({ ...prev, ...changes }) : null);
  const updateLocalUserStatus = (userId: string, changes: Partial<WatchInfo>) => {
      setLocalItem(prev => {
          if (!prev) return null;
          const current = prev.userStatus[userId] || { watched: false, watchedEpisodes: [] };
          return { ...prev, userStatus: { ...prev.userStatus, [userId]: { ...current, ...changes } } };
      });
  };

  const getYoutubeEmbedUrl = (url: string) => {
      const match = url.match(/^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/);
      return (match && match[2].length === 11) ? `https://www.youtube.com/embed/${match[2]}?autoplay=1` : null;
  };

  const RatingButton = ({ value, icon, activeColor, label }: any) => {
      const isSelected = localItem.rating === value;
      return (
          <button onClick={() => updateLocalItem({ rating: isSelected ? undefined : value })} className={`flex-1 flex flex-col items-center justify-center py-2 rounded-lg transition-all border border-slate-700/50 ${isSelected ? activeColor + ' bg-opacity-20 text-white' : 'hover:bg-slate-700 text-slate-500 hover:text-slate-300'}`} title={label}>{icon}</button>
      );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/90 backdrop-blur-sm" onClick={handleSaveAndClose} />
      <div className="relative bg-slate-800 rounded-2xl shadow-2xl w-full max-w-5xl overflow-hidden border border-slate-700 flex flex-col max-h-[90vh]">
        
        {/* Full Modal Trailer Overlay */}
        {isPlayingTrailer && localItem.trailerUrl && (
            <div className="absolute inset-0 z-[100] bg-black animate-in fade-in zoom-in-95">
                <iframe className="w-full h-full" src={getYoutubeEmbedUrl(localItem.trailerUrl) || ''} title="Trailer" frameBorder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen></iframe>
                <button onClick={() => setIsPlayingTrailer(false)} className="absolute top-6 right-6 p-3 bg-black/60 hover:bg-black/80 rounded-full text-white transition-all shadow-2xl border border-white/20"><X size={24} /></button>
            </div>
        )}

        <div className="h-40 lg:h-52 w-full relative shrink-0 bg-slate-900">
           {imageState < 2 && localItem.posterUrl ? (
              <img src={localItem.posterUrl} alt={localItem.title} className="w-full h-full object-cover opacity-60" onError={() => setImageState(2)} />
           ) : <div className="w-full h-full flex items-center justify-center opacity-60"><Film size={64} /></div>}
           <div className="absolute inset-0 bg-gradient-to-b from-transparent to-slate-800" />
           <button onClick={handleSaveAndClose} className="absolute top-3 right-3 p-2 bg-black/40 hover:bg-black/60 rounded-full text-white z-10"><X size={20} /></button>
           <div className="absolute bottom-4 left-6 z-10 flex gap-2">
              {localItem.trailerUrl ? (
                  <button onClick={() => setIsPlayingTrailer(true)} className="bg-red-600/90 hover:bg-red-600 text-white px-4 py-1.5 rounded-full text-xs font-bold flex items-center gap-2 backdrop-blur shadow-lg transition-transform hover:scale-105"><Youtube size={16} /> Ver Trailer</button>
              ) : !localItem.isEnriched && <div className="bg-indigo-600/50 text-indigo-100 px-4 py-1.5 rounded-full text-xs font-bold flex items-center gap-2 backdrop-blur animate-pulse"><Loader2 size={14} className="animate-spin" /> Buscando metadatos...</div>}
           </div>
        </div>

        <div className="p-6 -mt-2 relative z-10 flex-1 overflow-y-auto custom-scrollbar">
          <div className="lg:grid lg:grid-cols-12 lg:gap-8">
            <div className="lg:col-span-5 space-y-6">
                <div>
                    <div className="flex gap-2 mb-2 items-center">
                        <span className="bg-indigo-500/80 text-xs px-2 py-0.5 rounded text-white font-bold uppercase">{localItem.type === MediaType.MOVIE ? 'Peli' : 'Serie'}</span>
                        <span className="bg-slate-700/80 text-xs px-2 py-0.5 rounded text-slate-300">{localItem.year}</span>
                    </div>
                    <h2 className="text-3xl font-bold text-white mb-2">{localItem.title}</h2>
                    <p className="text-slate-300 text-sm leading-relaxed">{localItem.description}</p>
                </div>
                <div className="bg-slate-900/40 p-3 rounded-xl border border-slate-700/50">
                    <label className="text-[10px] text-slate-400 uppercase font-bold mb-2 block">Valoración</label>
                    <div className="flex gap-2">
                        <RatingButton value={9} activeColor="text-red-600" icon={<Ban size={20} />} label="Descartado" />
                        <RatingButton value={1} activeColor="text-red-500" icon={<ThumbsDown size={20} />} />
                        <RatingButton value={2} activeColor="text-blue-400" icon={<ThumbsUp size={20} />} />
                        <RatingButton value={3} activeColor="text-pink-500" icon={<Star size={20} />} />
                        <RatingButton value={4} activeColor="text-yellow-400" icon={<Star size={20} fill="currentColor" />} />
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-4 bg-slate-900/40 p-3 rounded-xl border border-slate-700/50">
                    <div>
                        <label className="text-[10px] text-slate-400 uppercase font-bold mb-1 flex items-center gap-1"><MonitorPlay size={10} /> Plataformas</label>
                        <button onClick={() => setShowPlatformSelector(true)} className="w-full bg-slate-800 border border-slate-700 text-xs text-left text-white rounded-lg py-2 px-3 flex justify-between items-center truncate">{localItem.platform?.length ? localItem.platform.join(', ') : 'Seleccionar...'}<ChevronDown size={12} /></button>
                    </div>
                    <div>
                        <label className="text-[10px] text-slate-400 uppercase font-bold mb-1 flex items-center gap-1"><Calendar size={10} /> Estreno</label>
                        <input type="date" value={localItem.releaseDate || ''} onChange={(e) => updateLocalItem({ releaseDate: e.target.value })} className="w-full bg-slate-800 border border-slate-700 text-xs text-white rounded-lg py-1.5 px-2 focus:outline-none" />
                    </div>
                </div>
            </div>

            <div className="lg:col-span-7 space-y-6">
                {localItem.type === MediaType.MOVIE ? (
                    <div className="bg-slate-900/30 rounded-xl p-4 border border-slate-700/30">
                        {users.map(user => {
                            const status = localItem.userStatus[user.id] || { watched: false };
                            return (
                                <div key={user.id} className="bg-slate-800 rounded-xl p-4 border border-slate-700/50 flex items-center justify-between mb-3 last:mb-0">
                                    <div className="flex items-center gap-3"><Avatar user={user} size="md" selected={status.watched} onClick={() => updateLocalUserStatus(user.id, { watched: !status.watched })} /><span>{user.name}</span></div>
                                    <button onClick={() => updateLocalUserStatus(user.id, { watched: !status.watched })} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${status.watched ? 'bg-green-500/20 text-green-400' : 'bg-slate-700 text-slate-400'}`}>{status.watched ? 'VISTO' : 'NO VISTO'}</button>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="space-y-4">
                        {localItem.seasons?.map(season => (
                            <div key={season.seasonNumber} className="bg-slate-900/50 rounded-xl border border-slate-700/50 overflow-hidden">
                                <div className="p-3 flex justify-between items-center">
                                    <span className="font-bold text-white">Temporada {season.seasonNumber}</span>
                                    <div className="flex gap-2">
                                        {users.map(u => {
                                            const watched = localItem.userStatus[u.id]?.watchedEpisodes?.filter(ep => ep.startsWith(`S${season.seasonNumber}`)).length || 0;
                                            return <div key={u.id} className="flex items-center gap-1"><div className="w-2 h-2 rounded-full" style={{backgroundColor: u.color}} /> <span className="text-[10px]">{watched}/{season.episodeCount}</span></div>;
                                        })}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
          </div>
        </div>

        <div className="p-4 bg-slate-900/50 border-t border-slate-700 flex justify-between items-center">
             <button onClick={() => { onDelete(localItem.id); onClose(); }} className="flex items-center gap-2 text-red-400 text-xs hover:bg-red-400/10 px-4 py-2 rounded-lg font-bold"><Trash2 size={16} /> Eliminar</button>
             <button onClick={handleSaveAndClose} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-2.5 rounded-lg font-bold text-sm shadow-xl"><Check size={18} /> Aceptar</button>
        </div>
      </div>

      {showPlatformSelector && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm">
             <div className="w-80 bg-slate-800 border border-slate-600 rounded-xl p-4">
                <div className="flex justify-between items-center mb-4"><span className="text-sm font-bold text-white">Plataformas</span><button onClick={() => setShowPlatformSelector(false)}><X size={16}/></button></div>
                <div className="grid grid-cols-3 gap-3">
                    {PLATFORM_OPTIONS.map(opt => (
                        <button key={opt.name} onClick={() => {
                            const current = localItem.platform || [];
                            updateLocalItem({ platform: current.includes(opt.name) ? current.filter(p => p !== opt.name) : [...current, opt.name] });
                        }} className={`flex flex-col items-center p-3 rounded-xl border-2 ${localItem.platform?.includes(opt.name) ? 'border-white/50 ' + opt.color : 'border-transparent bg-slate-700'}`}><span className="text-[10px] font-bold mt-1">{opt.name}</span></button>
                    ))}
                </div>
             </div>
        </div>
      )}
    </div>
  );
};

export default WatchedModal;
