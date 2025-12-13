import React, { useState } from 'react';
import { MediaItem, User, MediaType, Platform } from '../types';
import Avatar from './Avatar';
import { Film, Tv, Calendar } from 'lucide-react';

interface MediaCardProps {
  item: MediaItem;
  users: User[];
  onClick: (item: MediaItem) => void;
}

const getPlatformColor = (p?: Platform) => {
    switch(p) {
        case 'Netflix': return 'bg-red-600 text-white';
        case 'HBO': return 'bg-purple-900 text-white';
        case 'Disney+': return 'bg-blue-600 text-white';
        case 'AppleTV': return 'bg-gray-200 text-black';
        case 'Prime': return 'bg-sky-500 text-white';
        case 'Stremio': return 'bg-indigo-500 text-white';
        case 'Torrent': return 'bg-green-600 text-white';
        case 'Online': return 'bg-orange-500 text-white';
        default: return 'bg-slate-700 text-slate-300 hidden';
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
        
        {/* Gradient Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/20 to-transparent opacity-90" />
      </div>

      {/* Top Badges */}
      <div className="absolute top-3 left-3 flex flex-col gap-2 z-10 items-start">
        <span className={`px-2 py-1 rounded-md text-xs font-bold uppercase tracking-wider text-white backdrop-blur-md shadow-lg ${item.type === MediaType.MOVIE ? 'bg-indigo-600/90' : 'bg-pink-600/90'}`}>
          <div className="flex items-center gap-1">
            {item.type === MediaType.MOVIE ? <Film size={12} /> : <Tv size={12} />}
            {item.type === MediaType.MOVIE ? 'Peli' : 'Serie'}
          </div>
        </span>
        
        {/* Platform Badge */}
        {item.platform && (
             <span className={`px-2 py-0.5 rounded text-[10px] font-bold shadow-lg ${getPlatformColor(item.platform)}`}>
                 {item.platform}
             </span>
        )}
      </div>

      {/* Watched Status (Avatars) */}
      <div className="absolute top-3 right-3 flex -space-x-2 z-10">
        {usersWithActivity.map(user => (
          <Avatar key={user.id} user={user} size="sm" className="border-slate-900 ring-0" />
        ))}
      </div>

      {/* Content */}
      <div className="absolute bottom-0 left-0 right-0 p-4 transform translate-y-2 group-hover:translate-y-0 transition-transform duration-300 z-10">
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
    </div>
  );
};

export default MediaCard;