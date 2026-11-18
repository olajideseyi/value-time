"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { AudioLines, Play, Square, Upload, Trash2, CheckCircle2 } from "lucide-react";

const presets = [
  { value: "classic", label: "Classic chime", detail: "A clear, familiar three-note alert" },
  { value: "chime", label: "Bright chime", detail: "A brighter rising chime" },
  { value: "pulse", label: "Pulse", detail: "A short, rhythmic alert" },
  { value: "digital", label: "Digital", detail: "A crisp, modern notification" },
  { value: "bell", label: "Bell", detail: "A warm, resonant bell pattern" },
  { value: "soft", label: "Soft reminder", detail: "A quieter, gentle sequence" },
  { value: "urgent", label: "Urgent", detail: "A stronger repeating pattern" },
];

function playPreset(name: string, volume: number) {
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) throw new Error("Audio preview is not supported by this browser.");
  const context = new AudioContextClass();
  const patterns: Record<string, number[]> = {
    classic: [880, 988, 1174], chime: [660, 880, 1046, 1320],
    pulse: [880, 440, 880], digital: [1046, 784, 1046, 1568],
    bell: [523, 784, 1046], soft: [523, 659, 784], urgent: [988, 784, 988, 784, 1174],
  };
  const notes = patterns[name] || patterns.classic;
  notes.forEach((frequency, index) => {
    const start = context.currentTime + index * 0.19;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = name === "bell" ? "triangle" : "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.001, start);
    gain.gain.linearRampToValueAtTime(Math.max(0.001, volume * 0.18), start + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.001, start + (name === "soft" ? 0.24 : 0.16));
    oscillator.connect(gain); gain.connect(context.destination);
    oscillator.start(start); oscillator.stop(start + 0.27);
  });
  window.setTimeout(() => { void context.close(); }, 1800);
}

export function AlarmAudioSettings({ userId, preferences, onChange }: {
  userId: string; preferences: any; onChange: (value: any) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [note, setNote] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const volume = Math.max(0, Math.min(1, Number(preferences.alarm_volume ?? 0.75)));
  const customPath = preferences.custom_alarm_path as string | undefined;

  useEffect(() => () => { audioRef.current?.pause(); }, []);

  async function preview() {
    setNote("");
    try {
      if (customPath && preferences.alarm_sound === "custom") {
        if (!supabase) throw new Error("Audio storage is unavailable.");
        const { data, error } = await supabase.storage.from("alarm-audio").createSignedUrl(customPath, 300);
        if (error) throw error;
        audioRef.current?.pause();
        const audio = new Audio(data.signedUrl);
        audioRef.current = audio;
        audio.volume = volume;
        audio.onended = () => setPreviewing(false);
        await audio.play();
        setPreviewing(true);
        return;
      }
      playPreset(preferences.alarm_sound || "classic", volume);
      setPreviewing(true);
      window.setTimeout(() => setPreviewing(false), 1700);
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Could not play the preview.");
      setPreviewing(false);
    }
  }

  function stopPreview() {
    audioRef.current?.pause();
    audioRef.current = null;
    setPreviewing(false);
  }

  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !supabase) return;
    if (!file.type.startsWith("audio/")) { setNote("Choose an audio file."); event.target.value = ""; return; }
    if (file.size > 5 * 1024 * 1024) { setNote("Audio files must be 5 MB or smaller."); event.target.value = ""; return; }
    setUploading(true); setNote("");
    try {
      const extension = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "audio";
      const path = userId + "/" + crypto.randomUUID() + "." + extension;
      const { error } = await supabase.storage.from("alarm-audio").upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw error;
      onChange({ custom_alarm_path: path, custom_alarm_name: file.name, alarm_sound: "custom" });
      setNote("Custom alarm uploaded. Save your preferences to keep this selection.");
    } catch (error) {
      setNote(error instanceof Error ? error.message : "The audio upload failed.");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  async function removeCustom() {
    if (!supabase || !customPath) return;
    setUploading(true); setNote("");
    try {
      const { error } = await supabase.storage.from("alarm-audio").remove([customPath]);
      if (error) throw error;
      onChange({ custom_alarm_path: null, custom_alarm_name: null, alarm_sound: "classic" });
      stopPreview();
      setNote("Custom audio removed.");
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Could not remove the custom audio.");
    } finally { setUploading(false); }
  }

  return <section className="alarm-audio-settings">
    <div className="alarm-audio-heading"><div><span className="settings-kicker">PERSONALISE YOUR ALERT</span><strong>Alarm sound</strong><small>Choose a built-in tone or upload your own audio.</small></div><AudioLines size={21}/></div>
    <label className="alarm-select-label">Sound profile
      <select value={preferences.alarm_sound || "classic"} onChange={e => onChange({ alarm_sound: e.target.value })}>
        {presets.map(p => <option value={p.value} key={p.value}>{p.label}</option>)}
        <option value="custom" disabled={!customPath}>Your custom audio</option>
      </select>
      <small>{presets.find(p => p.value === (preferences.alarm_sound || "classic"))?.detail || (customPath ? "Your uploaded alarm audio" : "Upload a sound to use it here.")}</small>
    </label>
    <div className="alarm-audio-actions">
      <button type="button" className="secondary-button" onClick={preview} disabled={previewing || (preferences.alarm_sound === "custom" && !customPath)}><Play size={14}/> Preview sound</button>
      {previewing && <button type="button" className="secondary-button" onClick={stopPreview}><Square size={13}/> Stop</button>}
    </div>
    <label className="alarm-volume-label">Volume <strong>{Math.round(volume * 100)}%</strong>
      <input type="range" min="0" max="1" step="0.05" value={volume} onChange={e => onChange({ alarm_volume: Number(e.target.value) })}/>
    </label>
    <label className="toggle-row"><span>Repeat alarm pattern</span><input type="checkbox" checked={preferences.alarm_repeat !== false} onChange={e => onChange({ alarm_repeat: e.target.checked })}/></label>
    <div className="custom-alarm-upload">
      <div><strong>Use your own alarm</strong><small>MP3, WAV, OGG or other browser-supported audio · maximum 5 MB</small></div>
      <input ref={fileRef} type="file" accept="audio/*" onChange={upload} hidden/>
      <button type="button" className="secondary-button" onClick={() => fileRef.current?.click()} disabled={uploading}><Upload size={14}/>{uploading ? "Uploading…" : "Upload audio"}</button>
    </div>
    {customPath && <div className="custom-alarm-file"><CheckCircle2 size={15}/><span>{preferences.custom_alarm_name || "Custom alarm audio"}</span><button type="button" aria-label="Remove custom alarm audio" onClick={removeCustom} disabled={uploading}><Trash2 size={14}/></button></div>}
    <p className="alarm-audio-note">When the app is open, Value Time can play your selected tone or uploaded audio. When the app is in the background, the device and browser control the notification sound; websites cannot force a custom system notification tone.</p>
    {note && <p className="alarm-audio-feedback">{note}</p>}
  </section>;
}
