import React, { useState } from 'react';
import { MediaItem, User, MediaType } from '../types';
import Avatar from './Avatar';
import { Film, Tv, Calendar, ThumbsUp, ThumbsDown, Star, Sparkles } from 'lucide-react';

const AI_FIELD_LABELS: Record<keyof MediaItem['source'], string> = {
  title: 'Título',
  description: 'Descripción',
  trailer: 'Trailer',
};

interface MediaCardProps {
  item: MediaItem;
  users: User[];
  onClick: (item: MediaItem) => void;
}

const getPlatformColor = (p: string) => {
    switch(p) {
        case 'Netflix': return 'bg-red-600 text-white';
        case 'HBO': return 'bg-purple-900 text-white';
        case 'Disney+': return 'bg-blue-600 text-white';
        case 'AppleTV': return 'bg-gray-200 text-black';
        case 'Prime': return 'bg-sky-500 text-white';
        case 'Stremio': return 'bg-indigo-500 text-white';
        case 'Torrent': return 'bg-green-600 text-white';
        case 'Online': return 'bg-orange-500 text-white';
        case 'Cine': return 'bg-yellow-600 text-white';
        default: return 'bg-slate-700 text-slate-300';
    }
}

const MediaCard: React.FC<MediaCardProps> = ({ item, users, onClick }) => {
  // 0 = primary, 1 = backup, 2 = text fallback
  const [imageState, setImageState] = useState<0 | 1 | 2>(0);

  const handleImageError = () => {
    if (imageState === 0 && item.backupPosterUrl) {
        setImageState(1);
    } else {
        setImageState(2);
    }
  };

  const usersWithActivity = users.filter(u => {
      const status = item.userStatus[u.id];
      if (!status) return false;
      if (item.type === MediaType.MOVIE) return status.watched;
      if (item.type === MediaType.SERIES) return status.watchedEpisodes && status.watchedEpisodes.length > 0;
      return false;
  });

  const percent = users.length > 0 ? (usersWithActivity.length / users.length) * 100 : 0;
  const isFullyWatched = usersWithActivity.length === users.length;

  let currentSrc = item.posterUrl;
  if (imageState === 1 && item.backupPosterUrl) currentSrc = item.backupPosterUrl;

  const renderRating = () => {
      if (!item.rating) return null;
      switch(item.rating) {
          case 1: return <div className="bg-red-500 text-white p-1 rounded-full"><ThumbsDown size={12} /></div>;
          case 2: return <div className="bg-blue-500 text-white p-1 rounded-full"><ThumbsUp size={12} /></div>;
          case 3: return <div className="bg-pink-500 text-white p-1 rounded-full flex"><ThumbsUp size={10} className="-mr-1" /><ThumbsUp size={10} /></div>;
          case 4: return <div className="bg-yellow-500 text-black p-1 rounded-full"><Star size={12} fill="currentColor" /></div>;
          default: return null;
      }
  };

  // Safe Platform Access (ensure array)
  const platforms = Array.isArray(item.platform) ? item.platform : (item.platform ? [item.platform] : []);
  const aiFields = Object.entries(item.source || {})
    .filter(([, value]) => value === 'ai')
    .map(([key]) => AI_FIELD_LABELS[key as keyof MediaItem['source']]);

  return (
    <div
      onClick={() => onClick(item)}
      className="group relative flex flex-col bg-slate-800 rounded-xl overflow-hidden shadow-lg hover:shadow-2xl transition-all duration-300 hover:-translate-y-1 cursor-pointer w-full aspect-[2/3]"
    >
      {/* Background Image Area */}
      <div className="absolute inset-0 bg-slate-800 flex items-center justify-center overflow-hidden">
        {imageState < 2 && currentSrc ? (
            <img 
                src={currentSrc} 
                alt={item.title} 
                className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                onError={handleImageError}
                loading="lazy"
            />
        ) : (
            <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center bg-gradient-to-br from-slate-700 to-slate-900">
                <div className="mb-2 text-4xl opacity-20">
                    {item.type === MediaType.MOVIE ? <Film size={48} /> : <Tv size={48} />}
                </div>
                <h3 className="text-white font-black text-xl uppercase tracking-tight leading-none drop-shadow-lg line-clamp-4">
                    {item.title}
                </h3>
            </div>
        )}
        
        {/* Gradient Overlay - ONLY ON HOVER */}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
      </div>

      {/* Top Badges - ONLY ON HOVER */}
      <div className="absolute top-3 left-3 flex flex-col gap-2 z-10 items-start opacity-0 group-hover:opacity-100 transition-opacity duration-300 max-w-[80%]">
        <span className={`px-2 py-1 rounded-md text-xs font-bold uppercase tracking-wider text-white backdrop-blur-md shadow-lg ${item.type === MediaType.MOVIE ? 'bg-indigo-600/90' : 'bg-pink-600/90'}`}>
          <div className="flex items-center gap-1">
            {item.type === MediaType.MOVIE ? <Film size={12} /> : <Tv size={12} />}
            {item.type === MediaType.MOVIE ? 'Peli' : 'Serie'}
          </div>
        </span>
        
        {/* Platform Badges (Mosaic limit to 2 + counter) */}
        {platforms.length > 0 && (
            <div className="flex flex-wrap gap-1">
                {platforms.slice(0, 2).map(p => (
                    <span key={p} className={`px-2 py-0.5 rounded text-[10px] font-bold shadow-lg ${getPlatformColor(p)}`}>
                        {p}
                    </span>
                ))}
                {platforms.length > 2 && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold shadow-lg bg-slate-700 text-white">
                        +{platforms.length - 2}
                    </span>
                )}
            </div>
        )}
      </div>

      {/* Watched Status (Avatars) & Rating - ONLY ON HOVER */}
      <div className="absolute top-3 right-3 flex flex-col items-end gap-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
        <div className="flex -space-x-2">
            {usersWithActivity.map(user => (
            <Avatar key={user.id} user={user} size="sm" className="border-slate-900 ring-0" />
            ))}
        </div>
        {renderRating()}
      </div>

      {/* Content - ONLY ON HOVER */}
      <div className="absolute bottom-0 left-0 right-0 p-4 transform translate-y-2 group-hover:translate-y-0 opacity-0 group-hover:opacity-100 transition-all duration-300 z-10">
        <h3 className="text-white font-bold text-lg leading-tight mb-1 drop-shadow-md line-clamp-2">
          {item.title}
        </h3>
        
        <div className="flex items-center gap-2 text-slate-300 text-xs mb-2">
            <span>{item.year}</span>
            {item.releaseDate && (
                <span className="flex items-center gap-1 opacity-70">
                    • <Calendar size={10} /> {new Date(item.releaseDate).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })}
                </span>
            )}
        </div>
        
        {/* Activity Indicator */}
        <div className="w-full h-1 bg-slate-700 rounded-full overflow-hidden mt-2">
           <div
            className={`h-full ${isFullyWatched ? 'bg-green-500' : 'bg-blue-500'} transition-all duration-500`}
            style={{ width: `${percent}%` }}
           />
        </div>
      </div>

      {/* AI Source Indicator */}
      {aiFields.length > 0 && (
        <div className="absolute bottom-3 left-3 z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          <div
            className="flex items-center gap-1 text-amber-200 bg-slate-900/80 px-2 py-1 rounded-full text-[11px] border border-amber-300/30"
            title={`Datos generados por IA: ${aiFields.join(', ')}`}
          >
            <Sparkles size={14} />
            <span>IA</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default MediaCard;