import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { GoogleGenAI, LiveServerMessage, Modality, FunctionDeclaration, Type, Tool } from "@google/genai";
import { MediaItem, User, WatchInfo, SearchResult, MediaType } from '../types';
import { MessageSquare, Mic, Send, X, Sparkles, Loader2, Volume2, StopCircle, Plus, Check } from 'lucide-react';
import { searchMedia } from '../services/gemini';
import { MARK_AS_WATCHED_TOOL_DESCRIPTION, SYSTEM_INSTRUCTION_TEMPLATE } from '../constants/prompts';

interface WhisperChatProps {
    items: MediaItem[];
    users: User[];
    onAdd: (item: SearchResult, initialUserStatus?: Record<string, WatchInfo>) => void;
    onUpdate: (itemId: string, changes: Partial<MediaItem>) => void;
}

const VoiceVisualizer = ({ isUserTalking, isBotTalking, isConnected }: { isUserTalking: boolean; isBotTalking: boolean; isConnected: boolean }) => (
    <div className="flex flex-col items-center gap-4 w-full">
        <div className="flex items-center justify-center gap-1.5 h-16 w-full">
            {[...Array(12)].map((_, i) => {
                const isActive = (isUserTalking || isBotTalking) && isConnected;
                const colorClass = isBotTalking ? 'bg-pink-400' : 'bg-indigo-400';
                return (
                    <div 
                        key={i} 
                        className={`w-1.5 ${colorClass} rounded-full transition-all duration-150 ${isActive ? 'animate-bounce' : 'h-2 opacity-30'}`} 
                        style={{ 
                            height: isActive ? `${Math.random() * 60 + 20}%` : '8px', 
                            animationDelay: `${i * 0.05}s` 
                        }} 
                    />
                );
            })}
        </div>
        <div className="text-[10px] font-black tracking-[0.2em] uppercase flex items-center gap-2">
            {isBotTalking ? (
                <span className="text-pink-400 animate-pulse flex items-center gap-1"><Volume2 size={12} /> Whisper hablando</span>
            ) : isUserTalking ? (
                <span className="text-indigo-400 animate-pulse flex items-center gap-1"><Mic size={12} /> Escuchando...</span>
            ) : (
                <span className="text-slate-500">{isConnected ? 'Silencio' : 'Conectando'}</span>
            )}
        </div>
    </div>
);

const WhisperChat: React.FC<WhisperChatProps> = ({ items, users, onAdd, onUpdate }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<any[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isVoiceMode, setIsVoiceMode] = useState(false);
    const [isConnected, setIsConnected] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [isUserTalking, setIsUserTalking] = useState(false);

    const audioCtxRef = useRef<AudioContext | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const nextStartTimeRef = useRef<number>(0);
    const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
    
    // Silence detection refs
    const silenceTimeoutRef = useRef<number | null>(null);

    const markAsWatchedTool: FunctionDeclaration = {
        name: "markAsWatched",
        description: MARK_AS_WATCHED_TOOL_DESCRIPTION,
        parameters: {
            type: Type.OBJECT,
            properties: {
                title: { type: Type.STRING },
                who: { type: Type.STRING, enum: ['Jesus', 'Julia', 'ambos'] }
            },
            required: ["title"],
        },
    };

    const getSystemContext = () => {
        const watched = items.filter(i => {
            return i.rating !== undefined || Object.values(i.userStatus).some((s: WatchInfo) => s.watched || (s.watchedEpisodes?.length || 0) > 0);
        });

        const historyText = watched.slice(0, 50).map(i => {
            const myRating = i.rating ? `(Nota: ${i.rating}/4)` : '';
            return `- ${i.title} (${i.year}) ${myRating}`;
        }).join('\n');

        return SYSTEM_INSTRUCTION_TEMPLATE(historyText.substring(0, 10000));
    };

    const executeMarkAsWatched = async (args: any) => {
        const title = args.title;
        const who = args.who || 'Jesus';
        const targetIds = who === 'ambos' ? [users[0].id, users[1].id] : (who === 'Julia' ? [users[1].id] : [users[0].id]);
        
        const match = items.find(i => i.title.toLowerCase() === title.toLowerCase());
        if (match) {
            const status = { ...match.userStatus };
            targetIds.forEach(id => { status[id] = { watched: true, date: Date.now(), watchedEpisodes: [] }; });
            onUpdate(match.id, { userStatus: status });
            return `He marcado "${match.title}" para ${who}.`;
        }

        const res = await searchMedia(title);
        if (!res.length) return `No encontré "${title}".`;
        const initialStatus: any = {};
        targetIds.forEach(id => { initialStatus[id] = { watched: true, date: Date.now(), watchedEpisodes: [] }; });
        onAdd(res[0], initialStatus);
        return `Añadido y marcado "${res[0].title}" para ${who}.`;
    };

    const stopVoiceMode = async () => {
        if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
            try { await audioCtxRef.current.close(); } catch(e) {}
        }
        audioCtxRef.current = null;
        streamRef.current?.getTracks().forEach(t => t.stop());
        sourcesRef.current.forEach(s => s.stop());
        sourcesRef.current.clear();
        if (silenceTimeoutRef.current) window.clearTimeout(silenceTimeoutRef.current);
        
        setIsVoiceMode(false);
        setIsConnected(false);
        setIsSpeaking(false);
        setIsUserTalking(false);
    };

    const startVoiceMode = async () => {
        if (!process.env.API_KEY) return;
        setIsVoiceMode(true);
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            audioCtxRef.current = ctx;
            const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;

            const sessionPromise = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                config: { 
                    responseModalities: [Modality.AUDIO], 
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
                    systemInstruction: getSystemContext(),
                    tools: [{ functionDeclarations: [markAsWatchedTool] }]
                },
                callbacks: {
                    onopen: () => {
                        setIsConnected(true);
                        const source = ctx.createMediaStreamSource(stream);
                        const proc = ctx.createScriptProcessor(4096, 1, 1);
                        
                        proc.onaudioprocess = (e) => {
                            const data = e.inputBuffer.getChannelData(0);
                            
                            // Calculate simple RMS for volume
                            let sum = 0;
                            for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
                            const rms = Math.sqrt(sum / data.length);
                            const volume = rms * 100;

                            // Threshold for "user talking"
                            if (volume > 2) {
                                if (!isUserTalking) setIsUserTalking(true);
                                if (silenceTimeoutRef.current) {
                                    window.clearTimeout(silenceTimeoutRef.current);
                                    silenceTimeoutRef.current = null;
                                }
                            } else {
                                if (isUserTalking && !silenceTimeoutRef.current) {
                                    // Start 3s silence timeout before considering turn finished
                                    silenceTimeoutRef.current = window.setTimeout(() => {
                                        setIsUserTalking(false);
                                        silenceTimeoutRef.current = null;
                                    }, 3000);
                                }
                            }

                            const int16 = new Int16Array(data.length);
                            for (let i = 0; i < data.length; i++) int16[i] = data[i] * 32768;
                            
                            sessionPromise.then(s => {
                                try {
                                    s.sendRealtimeInput({ 
                                        media: { 
                                            data: btoa(String.fromCharCode(...new Uint8Array(int16.buffer))), 
                                            mimeType: 'audio/pcm;rate=16000' 
                                        } 
                                    });
                                } catch(err) {
                                    // Session might be closed
                                }
                            });
                        };
                        source.connect(proc);
                        proc.connect(ctx.destination);
                    },
                    onmessage: async (msg: LiveServerMessage) => {
                        if (msg.toolCall) {
                            for (const fc of msg.toolCall.functionCalls) {
                                const result = await executeMarkAsWatched(fc.args);
                                sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result } } }));
                            }
                        }
                        const audio = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                        if (audio) {
                            setIsSpeaking(true);
                            nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputCtx.currentTime);
                            const b64 = atob(audio);
                            const bytes = new Uint8Array(b64.length);
                            for(let i=0; i<b64.length; i++) bytes[i] = b64.charCodeAt(i);
                            const data16 = new Int16Array(bytes.buffer);
                            const buffer = outputCtx.createBuffer(1, data16.length, 24000);
                            const ch = buffer.getChannelData(0);
                            for(let i=0; i<data16.length; i++) ch[i] = data16[i] / 32768.0;
                            const s = outputCtx.createBufferSource();
                            s.buffer = buffer; s.connect(outputCtx.destination);
                            s.onended = () => { 
                                sourcesRef.current.delete(s); 
                                if(!sourcesRef.current.size) setIsSpeaking(false); 
                            };
                            s.start(nextStartTimeRef.current);
                            nextStartTimeRef.current += buffer.duration;
                            sourcesRef.current.add(s);
                        }
                    },
                    onclose: stopVoiceMode, 
                    onerror: stopVoiceMode
                }
            });
        } catch(e) { stopVoiceMode(); }
    };

    const handleSendText = async () => {
        if (!input.trim()) return;
        const msg = { id: Date.now(), role: 'user', text: input };
        setMessages(p => [...p, msg]); setInput(''); setIsLoading(true);
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const chat = ai.chats.create({ 
                model: 'gemini-3-flash-preview', 
                config: { 
                    systemInstruction: getSystemContext(), 
                    tools: [{ functionDeclarations: [markAsWatchedTool] }] 
                } 
            });
            const res = await chat.sendMessage({ message: input });
            if (res.functionCalls?.[0]) {
                const tr = await executeMarkAsWatched(res.functionCalls[0].args);
                const finalRes = await chat.sendMessage({ message: [{ functionResponse: { name: res.functionCalls[0].name, response: { result: tr } } }] });
                setMessages(p => [...p, { id: Date.now(), role: 'model', text: finalRes.text }]);
            } else { setMessages(p => [...p, { id: Date.now(), role: 'model', text: res.text }]); }
        } catch(e) { setMessages(p => [...p, { id: Date.now(), role: 'model', text: 'Error.' }]); }
        finally { setIsLoading(false); }
    };

    return (
        <>
            <button onClick={() => setIsOpen(!isOpen)} className="fixed left-6 bottom-6 z-40 bg-indigo-600 text-white p-4 rounded-full shadow-2xl transition-all hover:scale-110 active:scale-95"><Sparkles size={28} /></button>
            {isOpen && (
                <div className="fixed left-6 bottom-24 w-80 sm:w-96 h-[500px] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col z-40 animate-in slide-in-from-left-4 overflow-hidden">
                    <div className="bg-slate-800 p-4 border-b border-slate-700 flex justify-between items-center shrink-0">
                        <div className="flex items-center gap-2"><Sparkles className="text-indigo-400" size={18} /><span className="font-bold text-white tracking-tight">Whisper AI</span></div>
                        <button onClick={() => { stopVoiceMode(); setIsOpen(false); }} className="hover:bg-slate-700 p-1 rounded-full transition-colors"><X size={20} className="text-slate-400" /></button>
                    </div>
                    {isVoiceMode ? (
                        <div className="flex-1 flex flex-col items-center justify-center p-8 bg-indigo-950/20">
                            <VoiceVisualizer isUserTalking={isUserTalking} isBotTalking={isSpeaking} isConnected={isConnected} />
                            
                            <div className="mt-12 flex flex-col items-center gap-6">
                                <div className="relative flex items-center justify-center">
                                    <div className={`absolute inset-0 bg-indigo-500 rounded-full animate-ping opacity-20 ${isUserTalking ? 'block' : 'hidden'}`} />
                                    <div className={`w-20 h-20 rounded-full flex items-center justify-center shadow-2xl transition-all duration-500 ${isSpeaking ? 'bg-pink-600 scale-110' : isUserTalking ? 'bg-indigo-600' : 'bg-slate-700'}`}>
                                        {isSpeaking ? <Volume2 size={32} className="text-white" /> : <Mic size={32} className="text-white" />}
                                    </div>
                                </div>
                                
                                <button onClick={stopVoiceMode} className="bg-red-500/10 hover:bg-red-500/20 text-red-400 px-8 py-3 rounded-full border border-red-500/30 font-bold flex items-center gap-2 transition-all active:scale-95">
                                    <StopCircle size={20} /> Detener
                                </button>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                                {messages.length === 0 && (
                                    <div className="flex flex-col items-center justify-center h-full opacity-30 text-center px-8">
                                        <Sparkles size={48} className="mb-4" />
                                        <p className="text-sm font-medium">¿De qué te apetece hablar hoy?</p>
                                    </div>
                                )}
                                {messages.map(m => (
                                    <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                        <div className={`p-3 rounded-2xl text-sm max-w-[85%] shadow-md ${m.role === 'user' ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-slate-800 text-slate-100 rounded-tl-none'}`}>
                                            <div className="markdown-content">
                                                <ReactMarkdown>{m.text}</ReactMarkdown>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {isLoading && <div className="flex justify-start"><div className="bg-slate-800 p-3 rounded-2xl rounded-tl-none"><Loader2 className="animate-spin opacity-50 text-indigo-400" size={18} /></div></div>}
                            </div>
                            <div className="p-3 bg-slate-800 border-t border-slate-700 flex gap-2 shrink-0">
                                <button onClick={startVoiceMode} className="p-2 text-indigo-400 hover:bg-slate-700 rounded-full transition-colors" title="Modo Voz"><Mic size={22} /></button>
                                <input 
                                    type="text" 
                                    value={input} 
                                    onChange={e => setInput(e.target.value)} 
                                    onKeyDown={e => e.key === 'Enter' && handleSendText()} 
                                    placeholder="Escribe algo..." 
                                    className="flex-1 bg-slate-900 border border-slate-700 rounded-full px-4 py-2 text-sm focus:outline-none focus:border-indigo-500 transition-all text-white" 
                                />
                                <button onClick={handleSendText} disabled={!input.trim() || isLoading} className="p-2 bg-indigo-600 text-white rounded-full hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"><Send size={20} /></button>
                            </div>
                        </>
                    )}
                </div>
            )}
        </>
    );
};

export default WhisperChat;