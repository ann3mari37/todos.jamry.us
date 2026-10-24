import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import { useCallback, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { api } from './api';

type State = 'idle' | 'listening' | 'transcribing';

/**
 * Voice dictation.
 * - Web: the browser's built-in speech recognition (live, free) when available, otherwise record + transcribe.
 * - iOS/Android: record audio, then transcribe through the Worker (OpenAI), so no key ever lives on the device.
 */
export function useSpeech(onText: (text: string) => void) {
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState<string | null>(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const webRec = useRef<{ stop: () => void } | null>(null);

  const webSpeech = Platform.OS === 'web' && typeof window !== 'undefined'
    ? ((window as unknown as Record<string, unknown>).SpeechRecognition ?? (window as unknown as Record<string, unknown>).webkitSpeechRecognition) as (new () => {
        lang: string; interimResults: boolean; continuous: boolean;
        onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
        onend: () => void; onerror: (e: { error: string }) => void; start: () => void; stop: () => void;
      }) | undefined
    : undefined;

  const start = useCallback(async () => {
    setError(null);
    if (webSpeech) {
      const rec = new webSpeech();
      rec.lang = navigator.language || 'en-US';
      rec.interimResults = false;
      rec.continuous = true;
      let text = '';
      rec.onresult = (e) => {
        text = Array.from(e.results).map((r) => r[0].transcript).join(' ');
      };
      rec.onerror = (e) => setError(e.error === 'not-allowed' ? 'Microphone permission is needed.' : "Couldn't hear that. Try again or type.");
      rec.onend = () => {
        setState('idle');
        if (text.trim()) onText(text.trim());
      };
      webRec.current = rec;
      rec.start();
      setState('listening');
      return;
    }
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) {
      setError('Microphone permission is needed for voice capture.');
      return;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setState('listening');
  }, [webSpeech, recorder, onText]);

  const stop = useCallback(async () => {
    if (webRec.current) {
      webRec.current.stop();
      webRec.current = null;
      return;
    }
    await recorder.stop();
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    const uri = recorder.uri;
    if (!uri) { setState('idle'); return; }
    setState('transcribing');
    try {
      const form = new FormData();
      if (Platform.OS === 'web') {
        const blob = await (await fetch(uri)).blob();
        form.append('file', blob, 'speech.webm');
      } else {
        form.append('file', { uri, name: 'speech.m4a', type: 'audio/m4a' } as unknown as Blob);
      }
      const { text } = await api<{ text: string }>('/api/ai/transcribe', form, 60_000);
      if (text.trim()) onText(text.trim());
    } catch {
      setError("Couldn't transcribe right now. You can type instead — or use the keyboard's microphone.");
    } finally {
      setState('idle');
    }
  }, [recorder, onText]);

  return { state, error, start, stop, toggle: state === 'listening' ? stop : start };
}
