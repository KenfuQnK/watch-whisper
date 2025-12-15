import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { MediaItem, User, WatchInfo, SearchResult } from '../types';
import { MessageSquare, Mic, Send, X, Sparkles, Loader2, Volume2, StopCircle, Plus, Check } from 'lucide-react';
import { searchMedia } from '../services/gemini';

interface WhisperChatProps {
    items: MediaItem[];
    users: User[];
    onAdd: (item: SearchResult) => void;
}

interface ChatMessage {
    id: string;
    role: 'user' | 'model';
    text: string;
}

const WhisperChat: React.FC<WhisperChatProps> = ({ items, users, onAdd }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    
    // Voice Mode States
    const [isVoiceMode, setIsVoiceMode] = useState(false);
    const [isConnected, setIsConnected] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);

    // Refs
    const audioContextRef = useRef<AudioContext | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    
    const nextStartTimeRef = useRef<number>(0);
    const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

    // --- CONTEXT PREPARATION ---
    const getSystemContext = () => {
        // Summarize user history
        const watched = items.filter(i => {
            return i.rating !== undefined || Object.values(i.userStatus).some((s: WatchInfo) => s.watched || (s.watchedEpisodes?.length || 0) > 0);
        });

        const historyText = watched.map(i => {
            const myRating = i.rating ? `(Rated: ${i.rating}/4)` : '';
            return `- ${i.title} (${i.year}) [${i.type}] ${myRating}`;
        }).join('\n');

        return `
        You are "Whisper", a movie/series assistant.
        
        CONTEXT (History):
        ${historyText.substring(0, 10000)}

        RULES:
        1. BE DIRECT. Do not be enthusiastic. Do not use filler words like "Sure!", "Great choice!".
        2. DO NOT GREET (e.g., "Hello", "Hola") unless the user explicitly greets you first. Start answering immediately.
        3. Recommend NEW content based on history.
        4. If in Voice Mode, keep answers very short.
        
        CRITICAL FEATURE:
        When you recommend a specific movie or series, you MUST append a JSON code at the end of the paragraph to create an "Add" button.
        Format: \`:::{"title": "Exact Title", "year": "YYYY", "type": "movie" | "series"}:::\`
        
        Example: 
        "You should watch The Matrix. It is a sci-fi classic.
        :::{"title": "The Matrix", "year": "1999", "type": "movie"}:::"
        `;
    };

    // --- TEXT CHAT HANDLER ---
    const handleSendText = async () => {
        if (!input.trim() || !process.env.API_KEY) return;
        
        const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', text: input };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setIsLoading(true);

        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const chat = ai.chats.create({
                model: 'gemini-2.5-flash',
                config: { systemInstruction: getSystemContext() },
                history: messages.map(m => ({ role: m.role, parts: [{ text: m.text }] }))
            });

            const result = await chat.sendMessage({ message: userMsg.text });
            const modelMsg: ChatMessage = { id: (Date.now() + 1).toString(), role: 'model', text: result.text || "..." };
            
            setMessages(prev => [...prev, modelMsg]);
        } catch (e) {
            setMessages(prev => [...prev, { id: Date.now().toString(), role: 'model', text: "Error connecting." }]);
        } finally {
            setIsLoading(false);
        }
    };

    // --- VOICE MODE HANDLERS ---
    const stopVoiceMode = () => {
        if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
        if (processorRef.current) processorRef.current.disconnect();
        if (sourceRef.current) sourceRef.current.disconnect();
        if (audioContextRef.current) audioContextRef.current.close();
        
        sourcesRef.current.forEach(s => s.stop());
        sourcesRef.current.clear();
        
        setIsVoiceMode(false);
        setIsConnected(false);
        setIsSpeaking(false);
    };

    const startVoiceMode = async () => {
        if (!process.env.API_KEY) return;
        setIsVoiceMode(true);
        setIsConnected(false);

        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;
            
            const sessionPromise = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
                    systemInstruction: getSystemContext(),
                },
                callbacks: {
                    onopen: () => {
                        setIsConnected(true);
                        if (!audioContextRef.current) return;
                        const source = audioContextRef.current.createMediaStreamSource(stream);
                        const processor = audioContextRef.current.createScriptProcessor(4096, 1, 1);
                        processor.onaudioprocess = (e) => {
                            const inputData = e.inputBuffer.getChannelData(0);
                            const blob = createBlob(inputData);
                            sessionPromise.then(session => session.sendRealtimeInput({ media: blob }));
                        };
                        source.connect(processor);
                        processor.connect(audioContextRef.current.destination);
                        sourceRef.current = source;
                        processorRef.current = processor;
                    },
                    onmessage: async (msg: LiveServerMessage) => {
                        const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                        if (audioData) {
                            setIsSpeaking(true);
                            nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputCtx.currentTime);
                            const buffer = await decodeAudioData(audioData, outputCtx);
                            const source = outputCtx.createBufferSource();
                            source.buffer = buffer;
                            source.connect(outputCtx.destination);
                            source.onended = () => {
                                sourcesRef.current.delete(source);
                                if (sourcesRef.current.size === 0) setIsSpeaking(false);
                            };
                            source.start(nextStartTimeRef.current);
                            nextStartTimeRef.current += buffer.duration;
                            sourcesRef.current.add(source);
                        }
                    },
                    onclose: stopVoiceMode,
                    onerror: stopVoiceMode
                }
            });
        } catch (e) {
            stopVoiceMode();
        }
    };

    // Utils
    const createBlob = (data: Float32Array) => {
        const l = data.length;
        const int16 = new Int16Array(l);
        for (let i = 0; i < l; i++) { int16[i] = data[i] * 32768; }
        let binary = '';
        const bytes = new Uint8Array(int16.buffer);
        for (let i = 0; i < bytes.byteLength; i++) { binary += String.fromCharCode(bytes[i]); }
        return { data: btoa(binary), mimeType: 'audio/pcm;rate=16000' };
    };

    const decodeAudioData = async (base64: string, ctx: AudioContext) => {
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) { bytes[i] = binaryString.charCodeAt(i); }
        const dataInt16 = new Int16Array(bytes.buffer);
        const buffer = ctx.createBuffer(1, dataInt16.length, 24000);
        const channelData = buffer.getChannelData(0);
        for (let i = 0; i < dataInt16.length; i++) { channelData[i] = dataInt16[i] / 32768.0; }
        return buffer;
    };

    const messagesEndRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    return (
        <>
            <div className="fixed left-6 bottom-6 z-40">
                <button 
                    onClick={() => setIsOpen(!isOpen)}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white p-4 rounded-full shadow-2xl hover:scale-110 active:scale-95 flex items-center justify-center transition-all"
                >
                    <Sparkles size={28} className={isOpen ? 'animate-spin-slow' : ''} />
                </button>
            </div>

            {isOpen && (
                <div className="fixed left-6 bottom-24 w-80 sm:w-96 h-[500px] max-h-[70vh] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden z-40 animate-in slide-in-from-left-4 fade-in">
                    
                    <div className="bg-slate-800 p-4 border-b border-slate-700 flex justify-between items-center">
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center text-white"><Sparkles size={16} /></div>
                            <div>
                                <h3 className="font-bold text-white text-sm">Whisper</h3>
                                <span className="text-[10px] text-slate-400">
                                    {isVoiceMode ? (isConnected ? 'Escuchando...' : 'Conectando...') : 'Online'}
                                </span>
                            </div>
                        </div>
                        <button onClick={() => { stopVoiceMode(); setIsOpen(false); }} className="text-slate-400 hover:text-white"><X size={18} /></button>
                    </div>

                    {isVoiceMode ? (
                        <div className="flex-1 bg-indigo-900/20 flex flex-col items-center justify-center p-6 text-center">
                            <div className={`w-24 h-24 rounded-full border-4 flex items-center justify-center mb-6 transition-all ${isSpeaking ? 'border-indigo-400 scale-110' : 'border-slate-600'}`}>
                                <Volume2 size={40} className={`text-white ${isSpeaking ? 'animate-pulse' : 'opacity-50'}`} />
                            </div>
                            <button onClick={stopVoiceMode} className="bg-red-500/20 text-red-200 px-4 py-2 rounded-full text-xs font-bold border border-red-500/50 flex items-center gap-2">
                                <StopCircle size={14} /> Detener
                            </button>
                        </div>
                    ) : (
                        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-4 bg-slate-900">
                            {messages.length === 0 && <p className="text-center text-slate-500 text-sm mt-10">¿Qué te apetece ver hoy?</p>}
                            {messages.map(msg => (
                                <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-br-none' : 'bg-slate-800 text-slate-200 rounded-bl-none'}`}>
                                        <MessageRenderer text={msg.text} onAdd={onAdd} />
                                    </div>
                                </div>
                            ))}
                            {isLoading && <Loader2 size={20} className="animate-spin text-slate-500" />}
                            <div ref={messagesEndRef} />
                        </div>
                    )}

                    {!isVoiceMode && (
                        <div className="p-3 bg-slate-800 border-t border-slate-700 flex items-center gap-2">
                            <button onClick={startVoiceMode} className="p-2 bg-slate-700 rounded-full text-indigo-400"><Mic size={20} /></button>
                            <input 
                                type="text"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleSendText()}
                                placeholder="Escribe..."
                                className="flex-1 bg-slate-900 text-white text-sm rounded-full px-4 py-2 border border-slate-700 focus:outline-none focus:border-indigo-500"
                            />
                            <button onClick={handleSendText} disabled={!input.trim() || isLoading} className="p-2 bg-indigo-600 text-white rounded-full"><Send size={18} /></button>
                        </div>
                    )}
                </div>
            )}
        </>
    );
};

// --- RENDERER COMPONENT ---
// Parses text to find :::JSON::: patterns and renders Markdown + Add Buttons
const MessageRenderer: React.FC<{ text: string, onAdd: (item: SearchResult) => void }> = ({ text, onAdd }) => {
    // Regex matches content between ::: and :::
    const parts = text.split(/(:::{.*?}:::)/g);

    return (
        <div className="space-y-2">
            {parts.map((part, idx) => {
                if (part.startsWith(':::{') && part.endsWith(':::')) {
                    try {
                        const jsonStr = part.slice(3, -3);
                        const meta = JSON.parse(jsonStr);
                        return <AddButton key={idx} meta={meta} onAdd={onAdd} />;
                    } catch (e) {
                        return null;
                    }
                }
                if (!part.trim()) return null;
                // Basic Markdown Styles via standard HTML elements since no tailwind prose plugin in user config
                return (
                    <div key={idx} className="markdown-content">
                        <ReactMarkdown 
                            components={{
                                p: ({node, ...props}) => <p className="mb-2 last:mb-0" {...props} />,
                                strong: ({node, ...props}) => <strong className="font-bold text-indigo-300" {...props} />,
                                ul: ({node, ...props}) => <ul className="list-disc pl-4 mb-2" {...props} />,
                                li: ({node, ...props}) => <li className="mb-1" {...props} />
                            }}
                        >
                            {part}
                        </ReactMarkdown>
                    </div>
                );
            })}
        </div>
    );
};

// --- ADD BUTTON COMPONENT ---
const AddButton: React.FC<{ meta: any, onAdd: (item: SearchResult) => void }> = ({ meta, onAdd }) => {
    const [loading, setLoading] = useState(false);
    const [added, setAdded] = useState(false);

    const handleClick = async () => {
        if (added) return;
        setLoading(true);
        try {
            // Fetch real data to get poster/ID
            const results = await searchMedia(meta.title);
            const bestMatch = results[0]; // Simplified matching
            if (bestMatch) {
                onAdd(bestMatch);
                setAdded(true);
            } else {
                alert("No se pudo encontrar en la base de datos.");
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    if (added) {
        return (
            <div className="flex items-center gap-2 bg-green-900/30 text-green-400 p-2 rounded-lg text-xs font-bold border border-green-800">
                <Check size={14} /> Añadido: {meta.title}
            </div>
        );
    }

    return (
        <button 
            onClick={handleClick}
            disabled={loading}
            className="w-full flex items-center justify-between bg-slate-700 hover:bg-slate-600 text-white p-2 rounded-lg text-xs transition-colors border border-slate-600 mt-2 mb-2 group"
        >
            <span className="font-bold flex flex-col items-start">
                <span>{meta.title}</span>
                <span className="text-[10px] text-slate-400 font-normal">{meta.year} • {meta.type}</span>
            </span>
            <span className="bg-indigo-600 group-hover:bg-indigo-500 p-1.5 rounded-md">
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            </span>
        </button>
    );
};

export default WhisperChat;