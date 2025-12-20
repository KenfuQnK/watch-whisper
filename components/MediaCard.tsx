import React, { useState } from 'react';
import { View, Text, Pressable, Image, useWindowDimensions } from 'react-native';
import { MediaItem, User, MediaType } from '../types';
import Avatar from './Avatar';
import { Film, Tv, Calendar, ThumbsUp, ThumbsDown, Star, Ban } from 'lucide-react-native';

interface MediaCardProps {
  item: MediaItem;
  users: User[];
  onClick: (item: MediaItem) => void;
  columns: number;
}

const getPlatformColor = (p: string) => {
  switch (p) {
    case 'Netflix': return 'bg-red-600 text-white';
    case 'HBO': return 'bg-purple-900 text-white';
    case 'Disney+': return 'bg-blue-600 text-white';
    case 'AppleTV': return 'bg-gray-200 text-black';
    case 'Prime': return 'bg-sky-500 text-white';
    case 'Movistar+': return 'bg-black-500 text-white';
    case 'Stremio': return 'bg-indigo-500 text-white';
    case 'Torrent': return 'bg-green-600 text-white';
    case 'Online': return 'bg-orange-500 text-white';
    case 'Cine': return 'bg-yellow-600 text-white';
    default: return 'bg-slate-700 text-slate-300';
  }
};

const MediaCard: React.FC<MediaCardProps> = ({ item, users, onClick, columns }) => {
  const [imageState, setImageState] = useState<0 | 1 | 2>(0);
  const { width } = useWindowDimensions();
  const gutter = 12 * (columns - 1);
  const cardWidth = (width - 32 - gutter) / columns;

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
    if (item.rating === undefined || item.rating === 0) return null;

    switch (item.rating) {
      case 9: return <View className="bg-red-700 p-1 rounded-full"><Ban size={12} color="#fff" /></View>;
      case 1: return <View className="bg-red-500 p-1 rounded-full"><ThumbsDown size={12} color="#fff" /></View>;
      case 2: return <View className="bg-blue-500 p-1 rounded-full"><ThumbsUp size={12} color="#fff" /></View>;
      case 3: return (
        <View className="bg-pink-500 p-1 rounded-full flex-row">
          <ThumbsUp size={10} color="#fff" />
          <ThumbsUp size={10} color="#fff" />
        </View>
      );
      case 4: return <View className="bg-yellow-500 p-1 rounded-full"><Star size={12} color="#000" /></View>;
      default: return null;
    }
  };

  const platforms = Array.isArray(item.platform) ? item.platform : (item.platform ? [item.platform] : []);
  const isDiscarded = item.rating === 9;

  return (
    <Pressable
      onPress={() => onClick(item)}
      style={{ width: cardWidth, aspectRatio: 2 / 3 }}
      className={`relative bg-slate-800 rounded-xl overflow-hidden shadow-lg ${isDiscarded ? 'opacity-70' : ''}`}
    >
      <View className="absolute inset-0 bg-slate-800 items-center justify-center">
        {imageState < 2 && currentSrc ? (
          <Image
            source={{ uri: currentSrc }}
            onError={handleImageError}
            resizeMode="cover"
            style={{ width: '100%', height: '100%' }}
          />
        ) : (
          <View className="w-full h-full items-center justify-center p-4 bg-slate-900">
            <View className="mb-2 opacity-20">
              {item.type === MediaType.MOVIE ? <Film size={48} color="#fff" /> : <Tv size={48} color="#fff" />}
            </View>
            <Text className="text-white font-black text-xl uppercase text-center" numberOfLines={4}>
              {item.title}
            </Text>
          </View>
        )}
        <View className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/60 to-transparent" />
      </View>

      <View className="absolute top-3 left-3 flex-col gap-2 items-start max-w-[80%]">
        <View className={`px-2 py-1 rounded-md ${item.type === MediaType.MOVIE ? 'bg-indigo-600' : 'bg-pink-600'}`}>
          <View className="flex-row items-center gap-1">
            {item.type === MediaType.MOVIE ? <Film size={12} color="#fff" /> : <Tv size={12} color="#fff" />}
            <Text className="text-white text-xs font-bold">{item.type === MediaType.MOVIE ? 'Peli' : 'Serie'}</Text>
          </View>
        </View>
        {platforms.length > 0 && (
          <View className="flex-row flex-wrap gap-1">
            {platforms.slice(0, 2).map(p => (
              <View key={p} className={`px-2 py-0.5 rounded ${getPlatformColor(p)}`}>
                <Text className="text-[10px] font-bold">{p}</Text>
              </View>
            ))}
            {platforms.length > 2 && (
              <View className="px-2 py-0.5 rounded bg-slate-700">
                <Text className="text-[10px] font-bold text-white">+{platforms.length - 2}</Text>
              </View>
            )}
          </View>
        )}
      </View>

      <View className="absolute top-3 right-3 flex-col items-end gap-2">
        <View className="flex-row -space-x-2">
          {usersWithActivity.map(user => (
            <Avatar key={user.id} user={user} size="sm" className="border-slate-900" />
          ))}
        </View>
        {renderRating()}
      </View>

      <View className="absolute bottom-0 left-0 right-0 p-3">
        <Text className="text-white font-bold text-base" numberOfLines={2}>{item.title}</Text>
        <View className="flex-row items-center gap-2 text-slate-300 text-xs mt-1">
          <Text className="text-slate-300 text-xs">{item.year}</Text>
          {item.releaseDate ? (
            <View className="flex-row items-center gap-1">
              <Text className="text-slate-400">•</Text>
              <Calendar size={10} color="#cbd5f5" />
              <Text className="text-slate-300 text-xs">
                {new Date(item.releaseDate).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })}
              </Text>
            </View>
          ) : null}
        </View>
        <View className="w-full h-1 bg-slate-700 rounded-full overflow-hidden mt-2">
          <View
            className={`${isFullyWatched ? 'bg-green-500' : 'bg-blue-500'} h-full`}
            style={{ width: `${percent}%` }}
          />
        </View>
      </View>
    </Pressable>
  );
};

export default MediaCard;
