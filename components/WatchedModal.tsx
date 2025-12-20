import React, { useState, useEffect } from 'react';
import { Modal, View, Text, Pressable, ScrollView, Image, TextInput, Linking } from 'react-native';
import { MediaItem, User, MediaType, CollectionType, WatchInfo } from '../types';
import Avatar from './Avatar';
import { X, Check, Trash2, ChevronDown, Film, Tv, MonitorPlay, Calendar, ThumbsUp, ThumbsDown, Star, Youtube, Zap, Download, Wifi, Ticket, Ban } from 'lucide-react-native';

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
  { name: 'Netflix', color: 'bg-red-600' },
  { name: 'HBO', color: 'bg-purple-900' },
  { name: 'Disney+', color: 'bg-blue-600' },
  { name: 'Prime', color: 'bg-sky-500' },
  { name: 'AppleTV', color: 'bg-gray-200' },
  { name: 'Stremio', color: 'bg-indigo-500' },
  { name: 'Torrent', color: 'bg-green-600' },
  { name: 'Online', color: 'bg-orange-500' },
  { name: 'Cine', color: 'bg-yellow-500' },
];

const WatchedModal: React.FC<WatchedModalProps> = ({ item: propItem, users, isOpen, onClose, onUpdateItem, onDelete }) => {
  const [localItem, setLocalItem] = useState<MediaItem | null>(null);
  const [imageState, setImageState] = useState<0 | 1 | 2>(0);
  const [showPlatformSelector, setShowPlatformSelector] = useState(false);

  useEffect(() => {
    if (propItem) {
      setLocalItem(JSON.parse(JSON.stringify(propItem)));
      setImageState(0);
    } else {
      setLocalItem(null);
    }
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

  const RatingButton = ({ value, icon, activeColor }: any) => {
    const isSelected = localItem.rating === value;
    return (
      <Pressable onPress={() => updateLocalItem({ rating: isSelected ? undefined : value })} className={`flex-1 items-center justify-center py-2 rounded-lg border border-slate-700/50 ${isSelected ? activeColor : ''}`}>
        {icon}
      </Pressable>
    );
  };

  const openTrailer = async () => {
    if (localItem.trailerUrl) {
      await Linking.openURL(localItem.trailerUrl);
    }
  };

  return (
    <Modal visible={isOpen} animationType="slide" transparent>
      <View className="flex-1 bg-slate-900/90 p-4">
        <View className="flex-1 bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
          <View className="h-40 w-full bg-slate-900 relative">
            {imageState < 2 && localItem.posterUrl ? (
              <Image source={{ uri: localItem.posterUrl }} style={{ width: '100%', height: '100%', opacity: 0.6 }} onError={() => setImageState(2)} />
            ) : (
              <View className="w-full h-full items-center justify-center opacity-60">
                <Film size={64} color="#94a3b8" />
              </View>
            )}
            <View className="absolute inset-0 bg-gradient-to-b from-transparent to-slate-800" />
            <Pressable onPress={handleSaveAndClose} className="absolute top-3 right-3 p-2 bg-black/40 rounded-full">
              <X size={20} color="#fff" />
            </Pressable>
            <View className="absolute bottom-4 left-6 flex-row gap-2">
              {localItem.trailerUrl ? (
                <Pressable onPress={openTrailer} className="bg-red-600/90 px-4 py-1.5 rounded-full flex-row items-center gap-2">
                  <Youtube size={16} color="#fff" />
                  <Text className="text-white text-xs font-bold">Ver Trailer</Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          <ScrollView className="flex-1 p-4">
            <View className="gap-6">
              <View>
                <View className="flex-row gap-2 mb-2 items-center">
                  <View className="bg-indigo-500/80 px-2 py-0.5 rounded">
                    <Text className="text-xs text-white font-bold uppercase">{localItem.type === MediaType.MOVIE ? 'Peli' : 'Serie'}</Text>
                  </View>
                  <View className="bg-slate-700/80 px-2 py-0.5 rounded">
                    <Text className="text-xs text-slate-300">{localItem.year}</Text>
                  </View>
                </View>
                <Text className="text-2xl font-bold text-white mb-2">{localItem.title}</Text>
                <Text className="text-slate-300 text-sm">{localItem.description}</Text>
              </View>

              <View className="bg-slate-900/40 p-3 rounded-xl border border-slate-700/50">
                <Text className="text-[10px] text-slate-400 uppercase font-bold mb-2">Valoración</Text>
                <View className="flex-row gap-2">
                  <RatingButton value={9} activeColor="text-red-600" icon={<Ban size={20} color={localItem.rating === 9 ? '#dc2626' : '#64748b'} />} />
                  <RatingButton value={1} activeColor="text-red-500" icon={<ThumbsDown size={20} color={localItem.rating === 1 ? '#ef4444' : '#64748b'} />} />
                  <RatingButton value={2} activeColor="text-blue-400" icon={<ThumbsUp size={20} color={localItem.rating === 2 ? '#60a5fa' : '#64748b'} />} />
                  <RatingButton value={3} activeColor="text-pink-500" icon={<Star size={20} color={localItem.rating === 3 ? '#ec4899' : '#64748b'} />} />
                  <RatingButton value={4} activeColor="text-yellow-400" icon={<Star size={20} color={localItem.rating === 4 ? '#facc15' : '#64748b'} />} />
                </View>
              </View>

              <View className="flex-row gap-4 bg-slate-900/40 p-3 rounded-xl border border-slate-700/50">
                <View className="flex-1">
                  <View className="flex-row items-center gap-1 mb-1">
                    <MonitorPlay size={10} color="#94a3b8" />
                    <Text className="text-[10px] text-slate-400 uppercase font-bold">Plataformas</Text>
                  </View>
                  <Pressable onPress={() => setShowPlatformSelector(true)} className="bg-slate-800 border border-slate-700 rounded-lg py-2 px-3 flex-row items-center justify-between">
                    <Text className="text-xs text-white" numberOfLines={1}>{localItem.platform?.length ? localItem.platform.join(', ') : 'Seleccionar...'}</Text>
                    <ChevronDown size={12} color="#94a3b8" />
                  </Pressable>
                </View>
                <View className="flex-1">
                  <View className="flex-row items-center gap-1 mb-1">
                    <Calendar size={10} color="#94a3b8" />
                    <Text className="text-[10px] text-slate-400 uppercase font-bold">Estreno</Text>
                  </View>
                  <TextInput
                    value={localItem.releaseDate || ''}
                    onChangeText={(text) => updateLocalItem({ releaseDate: text })}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#64748b"
                    className="bg-slate-800 border border-slate-700 text-xs text-white rounded-lg py-2 px-2"
                  />
                </View>
              </View>

              {localItem.type === MediaType.MOVIE ? (
                <View className="bg-slate-900/30 rounded-xl p-4 border border-slate-700/30 gap-3">
                  {users.map(user => {
                    const status = localItem.userStatus[user.id] || { watched: false };
                    return (
                      <View key={user.id} className="bg-slate-800 rounded-xl p-4 border border-slate-700/50 flex-row items-center justify-between">
                        <View className="flex-row items-center gap-3">
                          <Avatar user={user} size="md" selected={status.watched} onClick={() => updateLocalUserStatus(user.id, { watched: !status.watched })} />
                          <Text className="text-white">{user.name}</Text>
                        </View>
                        <Pressable onPress={() => updateLocalUserStatus(user.id, { watched: !status.watched })} className={`px-3 py-1.5 rounded-lg ${status.watched ? 'bg-green-500/20' : 'bg-slate-700'}`}>
                          <Text className={`text-xs font-bold ${status.watched ? 'text-green-400' : 'text-slate-400'}`}>{status.watched ? 'VISTO' : 'NO VISTO'}</Text>
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
              ) : (
                <View className="gap-4">
                  {localItem.seasons?.map(season => (
                    <View key={season.seasonNumber} className="bg-slate-900/50 rounded-xl border border-slate-700/50 overflow-hidden">
                      <View className="p-3 flex-row justify-between items-center">
                        <Text className="font-bold text-white">Temporada {season.seasonNumber}</Text>
                        <View className="flex-row gap-2">
                          {users.map(u => {
                            const watched = localItem.userStatus[u.id]?.watchedEpisodes?.filter(ep => ep.startsWith(`S${season.seasonNumber}`)).length || 0;
                            return (
                              <View key={u.id} className="flex-row items-center gap-1">
                                <View className="w-2 h-2 rounded-full" style={{ backgroundColor: u.color }} />
                                <Text className="text-[10px] text-slate-300">{watched}/{season.episodeCount}</Text>
                              </View>
                            );
                          })}
                        </View>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </ScrollView>

          <View className="p-4 bg-slate-900/50 border-t border-slate-700 flex-row justify-between items-center">
            <Pressable onPress={() => { onDelete(localItem.id); onClose(); }} className="flex-row items-center gap-2 px-4 py-2 rounded-lg">
              <Trash2 size={16} color="#f87171" />
              <Text className="text-red-400 text-xs font-bold">Eliminar</Text>
            </Pressable>
            <Pressable onPress={handleSaveAndClose} className="flex-row items-center gap-2 bg-indigo-600 px-8 py-2.5 rounded-lg">
              <Check size={18} color="#fff" />
              <Text className="text-white font-bold text-sm">Aceptar</Text>
            </Pressable>
          </View>
        </View>

        <Modal visible={showPlatformSelector} transparent animationType="fade">
          <View className="flex-1 items-center justify-center bg-black/60">
            <View className="w-80 bg-slate-800 border border-slate-600 rounded-xl p-4">
              <View className="flex-row justify-between items-center mb-4">
                <Text className="text-sm font-bold text-white">Plataformas</Text>
                <Pressable onPress={() => setShowPlatformSelector(false)}>
                  <X size={16} color="#fff" />
                </Pressable>
              </View>
              <View className="flex-row flex-wrap gap-3">
                {PLATFORM_OPTIONS.map(opt => (
                  <Pressable
                    key={opt.name}
                    onPress={() => {
                      const current = localItem.platform || [];
                      updateLocalItem({ platform: current.includes(opt.name) ? current.filter(p => p !== opt.name) : [...current, opt.name] });
                    }}
                    className={`w-[30%] items-center p-3 rounded-xl border-2 ${localItem.platform?.includes(opt.name) ? `border-white/50 ${opt.color}` : 'border-transparent bg-slate-700'}`}
                  >
                    {opt.name === 'Stremio' && <Zap size={16} color="#fff" />}
                    {opt.name === 'Torrent' && <Download size={16} color="#fff" />}
                    {opt.name === 'Online' && <Wifi size={16} color="#fff" />}
                    {opt.name === 'Cine' && <Ticket size={16} color="#fff" />}
                    <Text className="text-[10px] font-bold mt-1 text-white">{opt.name}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </Modal>
  );
};

export default WatchedModal;
