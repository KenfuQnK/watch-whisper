import React, { useState, useRef } from 'react';
import { Modal, View, Text, Pressable, TextInput, ScrollView, ActivityIndicator } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import {
  GoogleGenAI,
  FunctionDeclaration,
  Type,
  FunctionCallingConfigMode,
  createPartFromFunctionCall,
  createPartFromFunctionResponse,
  Content
} from '@google/genai';
import { MediaItem, User, WatchInfo, SearchResult } from '../types';
import { MessageSquare, Mic, Send, X, Sparkles, Volume2, StopCircle } from 'lucide-react-native';
import { searchMedia } from '../services/gemini';
import { MARK_AS_WATCHED_TOOL_DESCRIPTION, SYSTEM_INSTRUCTION_TEMPLATE } from '../constants/prompts';
import { API_KEY } from '../lib/env';

interface WhisperChatProps {
  items: MediaItem[];
  users: User[];
  onAdd: (item: SearchResult, initialUserStatus?: Record<string, WatchInfo>) => void;
  onUpdate: (itemId: string, changes: Partial<MediaItem>) => void;
}

const WhisperChat: React.FC<WhisperChatProps> = ({ items, users, onAdd, onUpdate }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [history, setHistory] = useState<Content[]>([]);

  const recordingRef = useRef<Audio.Recording | null>(null);

  const markAsWatchedTool: FunctionDeclaration = {
    name: 'markAsWatched',
    description: MARK_AS_WATCHED_TOOL_DESCRIPTION,
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        who: { type: Type.STRING, enum: ['Jesus', 'Julia', 'ambos'] }
      },
      required: ['title'],
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

  const appendMessage = (role: 'user' | 'model', text: string) => {
    setMessages(prev => [...prev, { id: Date.now() + Math.random(), role, text }]);
  };

  const sendMessage = async (text: string) => {
    if (!API_KEY) return;
    const ai = new GoogleGenAI({ apiKey: API_KEY });
    const userContent: Content = { role: 'user', parts: [{ text }] };
    const nextHistory = [...history, userContent];

    setIsLoading(true);
    appendMessage('user', text);

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: nextHistory,
        config: {
          systemInstruction: getSystemContext(),
          tools: [{ functionDeclarations: [markAsWatchedTool] }],
          toolConfig: {
            functionCallingConfig: {
              mode: FunctionCallingConfigMode.AUTO,
              allowedFunctionNames: ['markAsWatched'],
            }
          }
        }
      });

      if (response.functionCalls && response.functionCalls.length > 0) {
        const functionCallParts = response.functionCalls.map(call => createPartFromFunctionCall(call.name, call.args));
        const modelFunctionContent: Content = { role: 'model', parts: functionCallParts };
        const functionResponseParts = await Promise.all(response.functionCalls.map(async (call, index) => {
          const result = await executeMarkAsWatched(call.args);
          const responseId = call.id || `${Date.now()}-${index}`;
          return createPartFromFunctionResponse(responseId, call.name, { result });
        }));
        const userFunctionContent: Content = { role: 'user', parts: functionResponseParts };

        const followupHistory = [...nextHistory, modelFunctionContent, userFunctionContent];
        const followup = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: followupHistory,
          config: {
            systemInstruction: getSystemContext(),
          }
        });

        if (followup.text) {
          appendMessage('model', followup.text);
          setHistory([...followupHistory, { role: 'model', parts: [{ text: followup.text }] }]);
        } else {
          setHistory(followupHistory);
        }
      } else if (response.text) {
        appendMessage('model', response.text);
        setHistory([...nextHistory, { role: 'model', parts: [{ text: response.text }] }]);
      } else {
        setHistory(nextHistory);
      }
    } catch (e) {
      appendMessage('model', 'Tuve un problema al responder. Intenta de nuevo.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim()) return;
    const current = input;
    setInput('');
    await sendMessage(current);
  };

  const startRecording = async () => {
    if (!API_KEY) return;
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') return;

      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await recording.startAsync();
      recordingRef.current = recording;
      setIsRecording(true);
    } catch (e) {
      setIsRecording(false);
    }
  };

  const stopRecording = async () => {
    if (!recordingRef.current) return;
    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;
      setIsRecording(false);

      if (uri) {
        setIsLoading(true);
        const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        const transcription = await transcribeAudio(base64);
        if (transcription) {
          await sendMessage(transcription);
        }
      }
    } catch (e) {
      setIsRecording(false);
      setIsLoading(false);
    }
  };

  const transcribeAudio = async (base64: string) => {
    if (!API_KEY) return '';
    try {
      const ai = new GoogleGenAI({ apiKey: API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { data: base64, mimeType: 'audio/m4a' } },
            { text: 'Transcribe el audio en español. Responde solo con el texto transcrito.' }
          ]
        }]
      });
      return response.text?.trim() || '';
    } catch (e) {
      return '';
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Pressable onPress={() => setIsOpen(true)} className="absolute bottom-6 right-6 bg-slate-800 p-3 rounded-full">
        <MessageSquare size={24} color="#fff" />
      </Pressable>

      <Modal visible={isOpen} animationType="slide" transparent>
        <View className="flex-1 bg-slate-900/95 px-4 pt-10">
          <View className="flex-row justify-between items-center mb-4">
            <View className="flex-row items-center gap-2">
              <Sparkles size={18} color="#f472b6" />
              <Text className="text-white font-bold text-lg">Whisper Chat</Text>
            </View>
            <Pressable onPress={() => setIsOpen(false)} className="p-2 bg-slate-800 rounded-full">
              <X size={18} color="#cbd5f5" />
            </Pressable>
          </View>

          <ScrollView className="flex-1 mb-4">
            {messages.length === 0 ? (
              <View className="items-center justify-center py-10">
                <View className="w-40 h-40 rounded-full bg-slate-800 items-center justify-center">
                  <Text className="text-slate-500 text-xs">Whisper</Text>
                </View>
                <Text className="text-slate-400 mt-4 text-center">Pregunta por recomendaciones o registra lo que has visto.</Text>
              </View>
            ) : (
              <View className="gap-3">
                {messages.map(msg => (
                  <View key={msg.id} className={`p-3 rounded-xl ${msg.role === 'user' ? 'bg-indigo-600/20' : 'bg-slate-800'}`}>
                    {msg.role === 'model' ? (
                      <Markdown style={{ body: { color: '#e2e8f0' } }}>{msg.text}</Markdown>
                    ) : (
                      <Text className="text-white">{msg.text}</Text>
                    )}
                  </View>
                ))}
              </View>
            )}
          </ScrollView>

          <View className="flex-row items-center gap-2 mb-4">
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder="Escribe un mensaje..."
              placeholderTextColor="#64748b"
              className="flex-1 bg-slate-800 text-white rounded-xl px-4 py-3"
            />
            <Pressable onPress={handleSend} disabled={isLoading || !input.trim()} className={`p-3 rounded-xl bg-indigo-600 ${isLoading || !input.trim() ? 'opacity-50' : ''}`}>
              <Send size={18} color="#fff" />
            </Pressable>
          </View>

          <View className="flex-row items-center justify-between">
            <Pressable onPress={isRecording ? stopRecording : startRecording} className={`flex-row items-center gap-2 px-4 py-2 rounded-full ${isRecording ? 'bg-red-600' : 'bg-slate-800'}`}>
              {isRecording ? <StopCircle size={16} color="#fff" /> : <Mic size={16} color="#fff" />}
              <Text className="text-white text-xs font-bold">{isRecording ? 'Detener' : 'Voz'}</Text>
            </Pressable>
            {isLoading && (
              <View className="flex-row items-center gap-2">
                <ActivityIndicator color="#fff" />
                <Text className="text-slate-300 text-xs">Procesando...</Text>
              </View>
            )}
            {!isLoading && (
              <View className="flex-row items-center gap-2">
                <Volume2 size={14} color="#64748b" />
                <Text className="text-slate-500 text-xs">Texto y voz</Text>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
};

export default WhisperChat;
