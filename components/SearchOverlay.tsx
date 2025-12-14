import React, { useRef, useState } from 'react';
import { Search, Loader2, Plus, AlertCircle, Edit3, Film, Tv, X } from 'lucide-react';
import { enrichInSpanish, rememberDiscardedResults, searchMedia } from '../services/gemini'; // Keeping filename but using new logic
import { SearchResult, MediaType } from '../types';

interface SearchOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (result: SearchResult) => void;
}

const SearchOverlay: React.FC<SearchOverlayProps> = ({ isOpen, onClose, onAdd }) => {
  const [mode, setMode] = useState<'api' | 'manual'>('api');
  
  // Search State
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isEnriching, setIsEnriching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const discardedResultsRef = useRef<SearchResult[]>([]);

  // Manual State
  const [manualTitle, setManualTitle] = useState('');
  const [manualType, setManualType] = useState<MediaType>(MediaType.MOVIE);

  if (!isOpen) return null;

  const getMetadataScore = (result: SearchResult) => {
    let score = 0;

    const sourcePriority: Record<string, number> = {
      itunes: 3,
      cinemeta: 2,
      tvmaze: 1,
      manual: 0,
    };

    score += sourcePriority[result.source] || 0;
    if (result.posterUrl) score += 2;
    if (result.backupPosterUrl) score += 1;
    if (result.description) score += Math.min(result.description.length / 80, 3);
    if (result.year) score += 1;

    return score;
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setIsLoading(true);
    setResults([]);
    setError(null);

    try {
      const data = await searchMedia(query);
      if (data && data.length > 0) {
        const sorted = [...data].sort((a, b) => getMetadataScore(b) - getMetadataScore(a));
        setResults(sorted);
      } else {
        setError("No encontramos nada. Intenta otro título o usa el modo Manual.");
      }
    } catch (err) {
      setError("Error de conexión con las bases de datos.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectResult = async (result: SearchResult) => {
    const discarded = results.filter((item) => item.id !== result.id);
    if (discarded.length) {
      discardedResultsRef.current = [...discardedResultsRef.current, ...discarded];
      rememberDiscardedResults(discarded);
    }

    setIsEnriching(true);
    try {
      const enriched = await enrichInSpanish(result);
      onAdd(enriched);
    } catch (enrichError) {
      console.error('Error enrichInSpanish:', enrichError);
      onAdd(result);
    } finally {
      setIsEnriching(false);
      onClose();
      resetState();
    }
  };

  const handleManualAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualTitle.trim()) return;

    const manualResult: SearchResult = {
        id: `manual-${Date.now()}`,
        externalId: Date.now(),
        source: 'manual',
        title: manualTitle,
        type: manualType,
        year: new Date().getFullYear().toString(),
        description: 'Añadido manualmente',
        posterUrl: '', // Will fallback to text
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
      setIsEnriching(false);
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center pt-10 px-4 bg-slate-900/95 backdrop-blur-md">
      <div className="w-full max-w-4xl flex flex-col h-full max-h-[90vh]">
        
        {/* Header */}
        <div className="flex justify-between items-center mb-6 shrink-0">
            <h2 className="text-3xl font-bold text-white">
                Añadir Título
            </h2>
            <button onClick={onClose} className="p-2 bg-slate-800 rounded-full hover:bg-slate-700 text-slate-400 hover:text-white transition-colors">
                <X size={24} />
            </button>
        </div>

        {/* Tabs */}
        <div className="flex p-1 bg-slate-800 rounded-xl mb-6 shrink-0">
            <button 
                onClick={() => setMode('api')}
                className={`flex-1 py-3 text-sm font-bold rounded-lg flex items-center justify-center gap-2 transition-all ${mode === 'api' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}
            >
                <Search size={16} /> Búsqueda Rápida
            </button>
            <button 
                onClick={() => setMode('manual')}
                className={`flex-1 py-3 text-sm font-bold rounded-lg flex items-center justify-center gap-2 transition-all ${mode === 'manual' ? 'bg-slate-700 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}
            >
                <Edit3 size={16} /> Manual
            </button>
        </div>

        {/* CONTENT AREA */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
            
            {/* API MODE */}
            {mode === 'api' && (
                <>
                    <form onSubmit={handleSearch} className="relative mb-6">
                        <input
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Avengers, Game of Thrones..."
                            className="w-full bg-slate-800 border-2 border-slate-700 text-white rounded-2xl py-4 pl-14 pr-14 text-lg focus:outline-none focus:border-indigo-500 focus:bg-slate-800/50 transition-all placeholder:text-slate-500"
                            autoFocus
                        />
                        <Search className="absolute left-5 top-1/2 transform -translate-y-1/2 text-slate-400" size={24} />
                        {query && (
                             <button 
                                type="button" 
                                onClick={() => setQuery('')}
                                className="absolute right-16 top-1/2 transform -translate-y-1/2 text-slate-500 hover:text-slate-300 p-2"
                             >
                                 <X size={20} />
                             </button>
                        )}
                        <button
                            type="submit"
                            disabled={isLoading || isEnriching || !query}
                            className="absolute right-3 top-1/2 transform -translate-y-1/2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white p-2.5 rounded-xl transition-all shadow-lg"
                        >
                            {isLoading ? <Loader2 className="animate-spin" size={20} /> : <Search size={20} />}
                        </button>
                    </form>

                    {error && (
                        <div className="flex items-center gap-2 text-red-400 bg-red-400/10 p-4 rounded-xl mb-6 animate-pulse">
                            <AlertCircle size={20} />
                            <p>{error}</p>
                        </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-10">
                        {results.map((result) => (
                            <div key={result.id} className="bg-slate-800 rounded-xl p-3 flex gap-4 hover:bg-slate-700/50 transition-colors group">
                                <div className="w-20 aspect-[2/3] bg-slate-900 rounded-lg overflow-hidden shrink-0 relative">
                                    {result.posterUrl ? (
                                        <img src={result.posterUrl} alt={result.title} className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center bg-slate-800 text-xs text-center p-1 text-slate-500 font-bold">Sin Foto</div>
                                    )}
                                </div>
                                <div className="flex-1 flex flex-col justify-between py-1">
                                    <div>
                                        <h3 className="font-bold text-white leading-tight mb-1">{result.title}</h3>
                                        <div className="flex items-center gap-2 text-xs text-slate-400 mb-2">
                                            <span className="uppercase tracking-wider font-bold bg-slate-900/50 px-1.5 py-0.5 rounded">
                                                {result.type === MediaType.MOVIE ? 'Película' : 'Serie'}
                                            </span>
                                            <span>{result.year}</span>
                                        </div>
                                        <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
                                            {result.description}
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => handleSelectResult(result)}
                                        disabled={isEnriching}
                                        className="mt-3 bg-green-600/20 hover:bg-green-600 text-green-400 hover:text-white py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all w-full disabled:opacity-60 disabled:cursor-not-allowed"
                                    >
                                        {isEnriching ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />} Seleccionar
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}

            {/* MANUAL MODE */}
            {mode === 'manual' && (
                <form onSubmit={handleManualAdd} className="bg-slate-800 p-6 rounded-2xl border border-slate-700">
                    <div className="mb-6">
                        <label className="block text-slate-400 text-sm font-bold mb-2">Título</label>
                        <input
                            type="text"
                            value={manualTitle}
                            onChange={(e) => setManualTitle(e.target.value)}
                            placeholder="Ej: Breaking Bad"
                            className="w-full bg-slate-900 border border-slate-700 rounded-xl p-4 text-white focus:outline-none focus:border-indigo-500"
                            required
                        />
                    </div>

                    <div className="mb-8">
                        <label className="block text-slate-400 text-sm font-bold mb-2">Tipo</label>
                        <div className="grid grid-cols-2 gap-4">
                            <button
                                type="button"
                                onClick={() => setManualType(MediaType.MOVIE)}
                                className={`p-4 rounded-xl border-2 flex flex-col items-center gap-2 transition-all ${manualType === MediaType.MOVIE ? 'border-indigo-500 bg-indigo-500/10 text-white' : 'border-slate-700 text-slate-500 hover:border-slate-600'}`}
                            >
                                <Film size={24} />
                                <span className="font-bold">Película</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setManualType(MediaType.SERIES)}
                                className={`p-4 rounded-xl border-2 flex flex-col items-center gap-2 transition-all ${manualType === MediaType.SERIES ? 'border-pink-500 bg-pink-500/10 text-white' : 'border-slate-700 text-slate-500 hover:border-slate-600'}`}
                            >
                                <Tv size={24} />
                                <span className="font-bold">Serie</span>
                            </button>
                        </div>
                    </div>

                    <button 
                        type="submit"
                        disabled={!manualTitle}
                        className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-transform active:scale-95"
                    >
                        <Plus size={20} /> Crear Card
                    </button>
                </form>
            )}
        </div>
      </div>
    </div>
  );
};

export default SearchOverlay;