import React, { useState } from 'react';
import { Modal, View, Text, Pressable, TextInput, ScrollView, Image } from 'react-native';
import { Search, Plus, AlertCircle, Edit3, Film, Tv, X } from 'lucide-react-native';
import { searchMedia } from '../services/gemini';
import { SearchResult, MediaType } from '../types';

interface SearchOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (result: SearchResult) => void;
}

const SearchOverlay: React.FC<SearchOverlayProps> = ({ isOpen, onClose, onAdd }) => {
  const [mode, setMode] = useState<'api' | 'manual'>('api');
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [manualTitle, setManualTitle] = useState('');
  const [manualType, setManualType] = useState<MediaType>(MediaType.MOVIE);

  const handleSearch = async () => {
    if (!query.trim()) return;

    setIsLoading(true);
    setResults([]);
    setError(null);

    try {
      const data = await searchMedia(query);
      if (data && data.length > 0) {
        setResults(data);
      } else {
        setError('No encontramos nada. Intenta otro título o usa el modo Manual.');
      }
    } catch (err) {
      setError('Error de conexión con las bases de datos.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleManualAdd = () => {
    if (!manualTitle.trim()) return;

    const manualResult: SearchResult = {
      id: `manual-${Date.now()}`,
      externalId: Date.now(),
      source: 'manual',
      title: manualTitle,
      type: manualType,
      year: new Date().getFullYear().toString(),
      description: 'Añadido manualmente',
      posterUrl: '',
    };
    onAdd(manualResult);
    onClose();
    resetState();
  };

  const resetState = () => {
    setQuery('');
    setResults([]);
    setManualTitle('');
    setMode('api');
  };

  return (
    <Modal visible={isOpen} animationType="slide" transparent>
      <View className="flex-1 bg-slate-900/95 px-4 pt-10">
        <View className="flex-1 max-h-[90%]">
          <View className="flex-row justify-between items-center mb-6">
            <Text className="text-3xl font-bold text-white">Añadir Título</Text>
            <Pressable onPress={onClose} className="p-2 bg-slate-800 rounded-full">
              <X size={24} color="#cbd5f5" />
            </Pressable>
          </View>

          <View className="flex-row p-1 bg-slate-800 rounded-xl mb-6">
            <Pressable
              onPress={() => setMode('api')}
              className={`flex-1 py-3 rounded-lg flex-row items-center justify-center gap-2 ${mode === 'api' ? 'bg-indigo-600' : ''}`}
            >
              <Search size={16} color={mode === 'api' ? '#fff' : '#94a3b8'} />
              <Text className={mode === 'api' ? 'text-white font-bold text-sm' : 'text-slate-400 font-bold text-sm'}>Búsqueda Rápida</Text>
            </Pressable>
            <Pressable
              onPress={() => setMode('manual')}
              className={`flex-1 py-3 rounded-lg flex-row items-center justify-center gap-2 ${mode === 'manual' ? 'bg-slate-700' : ''}`}
            >
              <Edit3 size={16} color={mode === 'manual' ? '#fff' : '#94a3b8'} />
              <Text className={mode === 'manual' ? 'text-white font-bold text-sm' : 'text-slate-400 font-bold text-sm'}>Manual</Text>
            </Pressable>
          </View>

          <ScrollView className="flex-1">
            {mode === 'api' && (
              <View>
                <View className="relative mb-6">
                  <View className="flex-row items-center bg-slate-800 border-2 border-slate-700 rounded-2xl px-4 py-3">
                    <Search size={20} color="#94a3b8" />
                    <TextInput
                      value={query}
                      onChangeText={setQuery}
                      placeholder="Avengers, Game of Thrones..."
                      placeholderTextColor="#64748b"
                      className="flex-1 text-white text-base ml-3"
                    />
                    {query ? (
                      <Pressable onPress={() => setQuery('')} className="p-2">
                        <X size={18} color="#94a3b8" />
                      </Pressable>
                    ) : null}
                    <Pressable
                      onPress={handleSearch}
                      disabled={isLoading || !query}
                      className={`ml-2 bg-indigo-600 rounded-xl p-2 ${isLoading || !query ? 'opacity-50' : ''}`}
                    >
                      <Search size={18} color="#fff" />
                    </Pressable>
                  </View>
                </View>

                {error && (
                  <View className="flex-row items-center gap-2 bg-red-400/10 p-4 rounded-xl mb-6">
                    <AlertCircle size={20} color="#f87171" />
                    <Text className="text-red-400">{error}</Text>
                  </View>
                )}

                <View className="gap-4 pb-10">
                  {results.map((result) => (
                    <View key={result.id} className="bg-slate-800 rounded-xl p-3 flex-row gap-4">
                      <View className="w-20 aspect-[2/3] bg-slate-900 rounded-lg overflow-hidden">
                        {result.posterUrl ? (
                          <Image source={{ uri: result.posterUrl }} style={{ width: '100%', height: '100%' }} />
                        ) : (
                          <View className="w-full h-full items-center justify-center bg-slate-800">
                            <Text className="text-xs text-slate-500 font-bold">Sin Foto</Text>
                          </View>
                        )}
                      </View>
                      <View className="flex-1 justify-between">
                        <View>
                          <Text className="font-bold text-white mb-1" numberOfLines={2}>{result.title}</Text>
                          <View className="flex-row items-center gap-2 mb-2">
                            <View className="bg-slate-900/50 px-2 py-1 rounded">
                              <Text className="text-xs text-slate-300 font-bold uppercase">
                                {result.type === MediaType.MOVIE ? 'Película' : 'Serie'}
                              </Text>
                            </View>
                            <Text className="text-xs text-slate-400">{result.year}</Text>
                          </View>
                          <Text className="text-xs text-slate-500" numberOfLines={2}>{result.description}</Text>
                        </View>
                        <Pressable
                          onPress={() => { onAdd(result); onClose(); resetState(); }}
                          className="mt-3 bg-green-600/20 py-2 rounded-lg"
                        >
                          <View className="flex-row items-center justify-center gap-2">
                            <Plus size={16} color="#86efac" />
                            <Text className="text-sm font-bold text-green-400">Seleccionar</Text>
                          </View>
                        </Pressable>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {mode === 'manual' && (
              <View className="bg-slate-800 p-6 rounded-2xl border border-slate-700">
                <View className="mb-6">
                  <Text className="text-slate-400 text-sm font-bold mb-2">Título</Text>
                  <TextInput
                    value={manualTitle}
                    onChangeText={setManualTitle}
                    placeholder="Ej: Breaking Bad"
                    placeholderTextColor="#64748b"
                    className="bg-slate-900 border border-slate-700 rounded-xl p-4 text-white"
                  />
                </View>

                <View className="mb-8">
                  <Text className="text-slate-400 text-sm font-bold mb-2">Tipo</Text>
                  <View className="flex-row gap-4">
                    <Pressable
                      onPress={() => setManualType(MediaType.MOVIE)}
                      className={`flex-1 p-4 rounded-xl border-2 items-center gap-2 ${manualType === MediaType.MOVIE ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-700'}`}
                    >
                      <Film size={24} color={manualType === MediaType.MOVIE ? '#fff' : '#94a3b8'} />
                      <Text className={manualType === MediaType.MOVIE ? 'font-bold text-white' : 'font-bold text-slate-500'}>Película</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setManualType(MediaType.SERIES)}
                      className={`flex-1 p-4 rounded-xl border-2 items-center gap-2 ${manualType === MediaType.SERIES ? 'border-pink-500 bg-pink-500/10' : 'border-slate-700'}`}
                    >
                      <Tv size={24} color={manualType === MediaType.SERIES ? '#fff' : '#94a3b8'} />
                      <Text className={manualType === MediaType.SERIES ? 'font-bold text-white' : 'font-bold text-slate-500'}>Serie</Text>
                    </Pressable>
                  </View>
                </View>

                <Pressable
                  onPress={handleManualAdd}
                  disabled={!manualTitle}
                  className={`w-full bg-green-600 py-3 rounded-xl ${!manualTitle ? 'opacity-50' : ''}`}
                >
                  <View className="flex-row items-center justify-center gap-2">
                    <Plus size={20} color="#fff" />
                    <Text className="text-white font-bold">Crear Card</Text>
                  </View>
                </Pressable>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

export default SearchOverlay;
