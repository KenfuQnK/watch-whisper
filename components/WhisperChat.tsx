import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { MediaItem, User, WatchInfo } from '../types';
import { MessageSquare, Mic, MicOff, Send, X, Sparkles, User as UserIcon, Loader2, Volume2, StopCircle } from 'lucide-react';

interface WhisperChatProps {
    items: MediaItem[];
    users: User[];
}

interface ChatMessage {
    id: string;
    role: 'user' | 'model';
    text: string;
}

const WhisperChat: React.FC<WhisperChatProps> = ({ items, users }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    
    // Voice Mode States
    const [isVoiceMode, setIsVoiceMode] = useState(false);
    const [isConnected, setIsConnected] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false); // Model speaking

    // Refs for Live API
    const audioContextRef = useRef<AudioContext | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const wsRef = useRef<any>(null); // To hold session promise or reference? Actually the SDK holds it.
    
    // We need to keep track of the session variable to close it properly, 
    // but the SDK uses a promise-based approach. We'll store the 'active' session cleanup function if possible or just use state flags.
    // The SDK example uses sessionPromise. We'll keep a ref to the close function if we can, or just manage state.
    
    const nextStartTimeRef = useRef<number>(0);
    const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

    // --- CONTEXT PREPARATION ---
    const getSystemContext = () => {
        // Summarize user history
        const watched = items.filter(i => {
            // Logic for "watched": Rating exists or watched status is true
            return i.rating !== undefined || Object.values(i.userStatus).some((s: WatchInfo) => s.watched || (s.watchedEpisodes?.length || 0) > 0);
        });

        const historyText = watched.map(i => {
            const myRating = i.rating ? `(Rated: ${i.rating}/4)` : '';
            return `- ${i.title} (${i.year}) [${i.type}] ${myRating}`;
        }).join('\n');

        return `
        You are "Whisper", a friendly and highly knowledgeable movie/series expert assistant.
        
        YOUR CONTEXT (User's History):
        ${historyText.substring(0, 10000)} ${historyText.length > 10000 ? '...(truncated)' : ''}

        YOUR GOAL:
        1. Recommend NEW content based on the history above. Do not recommend what they have already seen.
        2. Answer questions about plots, actors, or details without spoiling unless explicitly asked.
        3. Be concise and conversational.
        4. If in Voice Mode, keep answers shorter (1-3 sentences).
        
        TONE: Casual, enthusiastic, helpful.
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
            const modelMsg: ChatMessage = { id: (Date.now() + 1).toString(), role: 'model', text: result.text || "Sorry, I couldn't generate a response." };
            
            setMessages(prev => [...prev, modelMsg]);
        } catch (e) {
            setMessages(prev => [...prev, { id: Date.now().toString(), role: 'model', text: "Error connecting to Whisper." }]);
        } finally {
            setIsLoading(false);
        }
    };

    // --- VOICE MODE HANDLERS (LIVE API) ---
    
    // Audio Utils
    const createBlob = (data: Float32Array) => {
        const l = data.length;
        const int16 = new Int16Array(l);
        for (let i = 0; i < l; i++) {
            int16[i] = data[i] * 32768;
        }
        let binary = '';
        const bytes = new Uint8Array(int16.buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return {
            data: btoa(binary),
            mimeType: 'audio/pcm;rate=16000',
        };
    };

    const decodeAudioData = async (base64: string, ctx: AudioContext) => {
        const binaryString = atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        
        const dataInt16 = new Int16Array(bytes.buffer);
        const buffer = ctx.createBuffer(1, dataInt16.length, 24000);
        const channelData = buffer.getChannelData(0);
        for (let i = 0; i < dataInt16.length; i++) {
            channelData[i] = dataInt16[i] / 32768.0;
        }
        return buffer;
    };

    const stopVoiceMode = () => {
        // Clean up audio context & streams
        if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
        if (processorRef.current) processorRef.current.disconnect();
        if (sourceRef.current) sourceRef.current.disconnect();
        if (audioContextRef.current) audioContextRef.current.close();
        
        // Stop all playing sources
        sourcesRef.current.forEach(s => s.stop());
        sourcesRef.current.clear();

        // There is no explicit "close" method on the session promise wrapper easily accessible here
        // without keeping the session object. But reloading the component state essentially resets.
        // Ideally we would call session.close() if we stored the session object.
        
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
            
            // Setup Audio
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            // Output context for 24kHz
            const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
            
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;
            
            // Connect to Gemini Live
            const sessionPromise = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } }, // Friendly voice
                    systemInstruction: getSystemContext(),
                    inputAudioTranscription: { model: "gemini-2.5-flash" }, // Transcribe user input
                    outputAudioTranscription: { model: "gemini-2.5-flash" }, // Transcribe model output
                },
                callbacks: {
                    onopen: () => {
                        console.log("Whisper Live Connected");
                        setIsConnected(true);
                        
                        // Start Mic Stream
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
                        // 1. Handle Audio Output
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

                        // 2. Handle Text Transcription (So user sees what's happening)
                        if (msg.serverContent?.turnComplete) {
                            // Turn is done
                        }
                        
                        // Update chat with transcripts if available
                        if (msg.serverContent?.outputTranscription?.text) {
                             // This is tricky because it streams chunks. We might want to buffer it or just ignore for now to keep it simple.
                             // For a better UX, we'd update a "streaming" message.
                             // Let's simplified: Voice mode is audio-primary. We won't clutter the text chat with real-time chunks yet.
                        }
                    },
                    onclose: () => {
                        console.log("Whisper Live Closed");
                        stopVoiceMode();
                    },
                    onerror: (e) => {
                        console.error("Whisper Live Error", e);
                        stopVoiceMode();
                    }
                }
            });

        } catch (e) {
            console.error("Failed to start voice mode", e);
            stopVoiceMode();
        }
    };

    // Auto-scroll to bottom
    const messagesEndRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    return (
        <>
            {/* TOGGLE BUTTON */}
            <div className="fixed left-6 bottom-6 z-40">
                <button 
                    onClick={() => setIsOpen(!isOpen)}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white p-4 rounded-full shadow-2xl transition-transform hover:scale-110 active:scale-95 flex items-center justify-center relative group"
                    title="Hablar con Whisper"
                >
                    <Sparkles size={28} className={isOpen ? 'animate-spin-slow' : ''} />
                    {!isOpen && (
                         <span className="absolute left-full ml-3 bg-slate-800 text-white text-xs font-bold px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                             Pregúntale a Whisper
                         </span>
                    )}
                </button>
            </div>

            {/* CHAT WINDOW */}
            {isOpen && (
                <div className="fixed left-6 bottom-24 w-80 sm:w-96 h-[500px] max-h-[70vh] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden z-40 animate-in slide-in-from-left-4 fade-in">
                    
                    {/* Header */}
                    <div className="bg-slate-800 p-4 border-b border-slate-700 flex justify-between items-center">
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center text-white">
                                <Sparkles size={16} />
                            </div>
                            <div>
                                <h3 className="font-bold text-white text-sm">Whisper AI</h3>
                                <div className="flex items-center gap-1">
                                    <span className={`w-2 h-2 rounded-full ${isVoiceMode && isConnected ? 'bg-green-500 animate-pulse' : 'bg-slate-500'}`}></span>
                                    <span className="text-[10px] text-slate-400">
                                        {isVoiceMode ? (isConnected ? (isSpeaking ? 'Hablando...' : 'Escuchando...') : 'Conectando...') : 'Online'}
                                    </span>
                                </div>
                            </div>
                        </div>
                        <button onClick={() => { stopVoiceMode(); setIsOpen(false); }} className="text-slate-400 hover:text-white">
                            <X size={18} />
                        </button>
                    </div>

                    {/* Voice Mode Overlay */}
                    {isVoiceMode && (
                        <div className="flex-1 bg-indigo-900/20 flex flex-col items-center justify-center p-6 text-center relative">
                            <div className={`w-24 h-24 rounded-full border-4 flex items-center justify-center mb-6 transition-all ${isSpeaking ? 'border-indigo-400 shadow-[0_0_30px_rgba(129,140,248,0.5)] scale-110' : 'border-slate-600'}`}>
                                <Volume2 size={40} className={`text-white ${isSpeaking ? 'animate-pulse' : 'opacity-50'}`} />
                            </div>
                            <h4 className="text-white font-bold mb-2">Modo Conversación</h4>
                            <p className="text-xs text-indigo-200 mb-6">Habla naturalmente. Whisper te escucha.</p>
                            
                            <button 
                                onClick={stopVoiceMode}
                                className="bg-red-500/20 hover:bg-red-500 text-red-200 hover:text-white px-4 py-2 rounded-full text-xs font-bold border border-red-500/50 transition-colors flex items-center gap-2"
                            >
                                <StopCircle size={14} /> Terminar Voz
                            </button>

                             {/* Audio Visualization (Fake) */}
                             <div className="absolute bottom-0 left-0 right-0 h-16 flex items-end justify-center gap-1 pb-4 opacity-50">
                                 {[1,2,3,4,5,6,7,8].map(i => (
                                     <div key={i} className={`w-2 bg-indigo-500 rounded-t-md transition-all duration-100 ${isSpeaking || isConnected ? 'animate-pulse' : 'h-2'}`} style={{ height: isSpeaking ? Math.random() * 40 + 10 + 'px' : '4px' }}></div>
                                 ))}
                             </div>
                        </div>
                    )}

                    {/* Messages Area (Hidden in voice mode mostly, or shown underneath?) Let's hide in voice mode for simplicity or show text if we had transcription */}
                    {!isVoiceMode && (
                        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-4 bg-slate-900">
                            {messages.length === 0 && (
                                <div className="text-center text-slate-500 mt-10">
                                    <p className="text-sm mb-2">¡Hola! Soy tu experto en cine.</p>
                                    <p className="text-xs">Puedo recomendarte pelis basadas en lo que has visto o responder dudas.</p>
                                </div>
                            )}
                            {messages.map(msg => (
                                <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-br-none' : 'bg-slate-800 text-slate-200 rounded-bl-none'}`}>
                                        {msg.text}
                                    </div>
                                </div>
                            ))}
                            {isLoading && (
                                <div className="flex justify-start">
                                    <div className="bg-slate-800 rounded-2xl px-3 py-2 rounded-bl-none">
                                        <Loader2 size={16} className="animate-spin text-slate-400" />
                                    </div>
                                </div>
                            )}
                            <div ref={messagesEndRef} />
                        </div>
                    )}

                    {/* Input Area */}
                    {!isVoiceMode && (
                        <div className="p-3 bg-slate-800 border-t border-slate-700 flex items-center gap-2">
                            <button 
                                onClick={startVoiceMode}
                                className="p-2 bg-slate-700 hover:bg-slate-600 rounded-full text-indigo-400 transition-colors"
                                title="Iniciar Modo Voz"
                            >
                                <Mic size={20} />
                            </button>
                            <input 
                                type="text"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleSendText()}
                                placeholder="Escribe algo..."
                                className="flex-1 bg-slate-900 text-white text-sm rounded-full px-4 py-2 border border-slate-700 focus:outline-none focus:border-indigo-500"
                            />
                            <button 
                                onClick={handleSendText}
                                disabled={!input.trim() || isLoading}
                                className="p-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-full transition-colors"
                            >
                                <Send size={18} />
                            </button>
                        </div>
                    )}
                </div>
            )}
        </>
    );
};

export default WhisperChat;