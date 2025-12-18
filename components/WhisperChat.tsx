import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { GoogleGenAI, LiveServerMessage, Modality, FunctionDeclaration, Type, Tool } from "@google/genai";
import { MediaItem, User, WatchInfo, SearchResult, MediaType } from '../types';
import { MessageSquare, Mic, Send, X, Sparkles, Loader2, Volume2, StopCircle, Plus, Check } from 'lucide-react';
import { searchMedia } from '../services/gemini';

interface WhisperChatProps {
    items: MediaItem[];
    users: User[];
    onAdd: (item: SearchResult, initialUserStatus?: Record<string, WatchInfo>) => void;
    onUpdate: (itemId: string, changes: Partial<MediaItem>) => void;
}

const VoiceVisualizer = ({ isActive }: { isActive: boolean }) => (
    <div className="flex items-center justify-center gap-1.5 h-16 w-full">
        {[...Array(8)].map((_, i) => (
            <div key={i} className={`w-1.5 bg-indigo-400 rounded-full transition-all duration-150 ${isActive ? 'animate-bounce' : 'h-2 opacity-30'}`} style={{ height: isActive ? `${Math.random() * 40 + 20}%` : '8px', animationDelay: `${i * 0.1}s` }} />
        ))}
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

    const audioCtxRef = useRef<AudioContext | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const nextStartTimeRef = useRef<number>(0);
    const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

    const markAsWatchedTool: FunctionDeclaration = {
        name: "markAsWatched",
        description: "Usa esta herramienta cuando confirmen haber visto algo. Para Jesus, Julia o ambos.",
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
        const history = items.filter(i => Object.values(i.userStatus).some((s: any) => s.watched)).slice(0, 30).map(i => `- ${i.title}`).join('\n');
        return `Eres Whisper, experto en cine. Jesús (${users[0].id}) y Julia (${users[1].id}). Usa JSON :::{"title":"...","year":"...","type":"..."}::: para botones. Historial:\n${history}`;
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
        streamRef.current?.getTracks().forEach(t => t.stop());
        sourcesRef.current.forEach(s => s.stop());
        sourcesRef.current.clear();
        setIsVoiceMode(false);
        setIsConnected(false);
        setIsSpeaking(false);
    };

    const startVoiceMode = async () => {
        if (!process.env.API_KEY) return;
        setIsVoiceMode(true);
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const ctx = new AudioContext({ sampleRate: 16000 });
            audioCtxRef.current = ctx;
            const outputCtx = new AudioContext({ sampleRate: 24000 });
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
                            const int16 = new Int16Array(data.length);
                            for (let i = 0; i < data.length; i++) int16[i] = data[i] * 32768;
                            sessionPromise.then(s => s.sendRealtimeInput({ media: { data: btoa(String.fromCharCode(...new Uint8Array(int16.buffer))), mimeType: 'audio/pcm;rate=16000' } }));
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
                            s.onended = () => { sourcesRef.current.delete(s); if(!sourcesRef.current.size) setIsSpeaking(false); };
                            s.start(nextStartTimeRef.current);
                            nextStartTimeRef.current += buffer.duration;
                            sourcesRef.current.add(s);
                        }
                    },
                    onclose: stopVoiceMode, onerror: stopVoiceMode
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
            // Corrected model name to 'gemini-3-flash-preview' as per guidelines
            const chat = ai.chats.create({ model: 'gemini-3-flash-preview', config: { systemInstruction: getSystemContext(), tools: [{ functionDeclarations: [markAsWatchedTool] }] } });
            const res = await chat.sendMessage({ message: input });
            if (res.functionCalls?.[0]) {
                const tr = await executeMarkAsWatched(res.functionCalls[0].args);
                const finalRes = await chat.sendMessage({ message: [{ functionResponse: { name: res.functionCalls[0].name, response: { result: tr } } }] });
                // Correctly accessing .text property
                setMessages(p => [...p, { id: Date.now(), role: 'model', text: finalRes.text }]);
            } else { setMessages(p => [...p, { id: Date.now(), role: 'model', text: res.text }]); }
        } catch(e) { setMessages(p => [...p, { id: Date.now(), role: 'model', text: 'Error.' }]); }
        finally { setIsLoading(false); }
    };

    return (
        <>
            <button onClick={() => setIsOpen(!isOpen)} className="fixed left-6 bottom-6 z-40 bg-indigo-600 text-white p-4 rounded-full shadow-2xl transition-all hover:scale-110"><Sparkles size={28} /></button>
            {isOpen && (
                <div className="fixed left-6 bottom-24 w-80 sm:w-96 h-[500px] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col z-40 animate-in slide-in-from-left-4">
                    <div className="bg-slate-800 p-4 border-b border-slate-700 flex justify-between items-center rounded-t-2xl">
                        <div className="flex items-center gap-2"><Sparkles className="text-indigo-400" size={18} /><span className="font-bold text-white">Whisper AI</span></div>
                        <button onClick={() => { stopVoiceMode(); setIsOpen(false); }}><X size={20} className="text-slate-400" /></button>
                    </div>
                    {isVoiceMode ? (
                        <div className="flex-1 flex flex-col items-center justify-center p-8 bg-indigo-950/20">
                            <p className="text-indigo-200 text-sm mb-8">{isSpeaking ? 'Whisper hablando...' : 'Escuchando tu voz...'}</p>
                            <VoiceVisualizer isActive={!isSpeaking && isConnected} />
                            {isSpeaking && <div className="animate-pulse bg-indigo-500/20 rounded-full p-4 mb-8"><Volume2 size={48} className="text-indigo-400" /></div>}
                            <button onClick={stopVoiceMode} className="mt-8 bg-red-500/20 text-red-400 px-6 py-2 rounded-full border border-red-500/40 font-bold flex items-center gap-2"><StopCircle size={18} /> Detener Voz</button>
                        </div>
                    ) : (
                        <>
                            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                                {messages.map(m => (
                                    <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                        <div className={`p-3 rounded-2xl text-sm max-w-[85%] ${m.role === 'user' ? 'bg-indigo-600' : 'bg-slate-800'}`}>
                                            {/* Wrapped ReactMarkdown in a div to fix className error in react-markdown */}
                                            <div className="markdown-content">
                                                <ReactMarkdown>{m.text}</ReactMarkdown>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {isLoading && <Loader2 className="animate-spin opacity-50" />}
                            </div>
                            <div className="p-3 bg-slate-800 border-t border-slate-700 flex gap-2">
                                <button onClick={startVoiceMode} className="p-2 text-indigo-400 hover:bg-slate-700 rounded-full"><Mic size={20} /></button>
                                <input type="text" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSendText()} placeholder="Habla conmigo..." className="flex-1 bg-slate-900 rounded-full px-4 text-sm" />
                                <button onClick={handleSendText} className="p-2 bg-indigo-600 rounded-full"><Send size={18} /></button>
                            </div>
                        </>
                    )}
                </div>
            )}
        </>
    );
};

export default WhisperChat;