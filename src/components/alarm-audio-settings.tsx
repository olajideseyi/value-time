"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
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

async function playPreset(name: string, volume: number) {
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) throw new Error("Audio preview is not supported by this browser.");
  const context = new AudioContextClass();
  if (context.state === "suspended") await context.resume();
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
  const acceptedAudio = /\.(mp3|wav|ogg|oga|m4a|aac|weba|webm)$/i;

  useEffect(() => () => { audioRef.current?.pause(); }, []);

  async function preview() {
    setNote("");
    try {
      if (preferences.alarm_sound === "system") {
        if (!("Notification" in window)) throw new Error("System notifications are not supported by this browser.");
        let permission = Notification.permission;
        if (permission === "default") permission = await Notification.requestPermission();
        if (permission !== "granted") throw new Error("Allow notifications for Value Time in your device settings to preview the system notification sound.");
        if (!("serviceWorker" in navigator)) throw new Error("This browser cannot show installed-app notifications. Try the installed Value Time app on your device.");
        const registration = await navigator.serviceWorker.ready;
        const notificationOptions = { body: "This uses your device’s default notification sound. The sound and vibration are controlled by your device settings.", icon: "/icon.svg", tag: "value-time-sound-test-" + Date.now(), silent: false, vibrate: [180, 80, 180] } as NotificationOptions & { vibrate: number[] };
        await registration.showNotification("Value Time sound test", notificationOptions);
        setPreviewing(true);
        window.setTimeout(() => setPreviewing(false), 1200);
        return;
      }
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
      await playPreset(preferences.alarm_sound || "classic", volume);
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

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !supabase) return;
    if (!file.type.startsWith("audio/") && !acceptedAudio.test(file.name)) { setNote("Choose an MP3, WAV, OGG, M4A, AAC or other supported audio file."); event.target.value = ""; return; }
    if (file.size > 5 * 1024 * 1024) { setNote("Audio files must be 5 MB or smaller."); event.target.value = ""; return; }
    setUploading(true); setNote("");
    try {
      const extension = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "audio";
      const path = userId + "/" + crypto.randomUUID() + "." + extension;
      const contentType = file.type || ({ mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac", weba: "audio/webm", webm: "audio/webm" } as Record<string, string>)[extension] || "application/octet-stream";
      const { error } = await supabase.storage.from("alarm-audio").upload(path, file, { contentType, upsert: false });
      if (error) throw error;
      const saved = await supabase.from("user_preferences").upsert({ user_id: userId, custom_alarm_path: path, custom_alarm_name: file.name, alarm_sound: "custom" }, { onConflict: "user_id" });
      if (saved.error) { await supabase.storage.from("alarm-audio").remove([path]); throw saved.error; }
      onChange({ custom_alarm_path: path, custom_alarm_name: file.name, alarm_sound: "custom" });
      if (customPath) await supabase.storage.from("alarm-audio").remove([customPath]);
      setNote("Your custom alarm is uploaded and saved.");
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
      const saved = await supabase.from("user_preferences").update({ custom_alarm_path: null, custom_alarm_name: null, alarm_sound: "classic" }).eq("user_id", userId);
      if (saved.error) throw saved.error;
      const { error } = await supabase.storage.from("alarm-audio").remove([customPath]);
      if (error) setNote("Your custom alarm was disconnected, but its stored file could not be deleted: " + error.message);
      else setNote("Custom audio removed.");
      onChange({ custom_alarm_path: null, custom_alarm_name: null, alarm_sound: "classic" });
      stopPreview();
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Could not remove the custom audio.");
    } finally { setUploading(false); }
  }

  return <section className="alarm-audio-settings">
    <div className="alarm-audio-heading"><div><span className="settings-kicker">PERSONALISE YOUR ALERT</span><strong>Alarm sound</strong><small>Use your device notification sound, a Value Time tone, or your own audio.</small></div><AudioLines size={21}/></div>
    <label className="alarm-select-label">Sound profile
      <select value={preferences.alarm_sound || "classic"} onChange={e => onChange({ alarm_sound: e.target.value })}>
        <option value="system">Device default notification sound</option>
        {presets.map(p => <option value={p.value} key={p.value}>{p.label}</option>)}
        <option value="custom" disabled={!customPath}>Your custom audio</option>
      </select>
      <small>{preferences.alarm_sound === "system" ? "Uses the notification sound selected by iOS, Android or your browser. Change it in your device notification settings." : presets.find(p => p.value === (preferences.alarm_sound || "classic"))?.detail || (customPath ? "Your uploaded alarm audio" : "Upload a sound to use it here.")}</small>
    </label>
    <div className="alarm-audio-actions">
      <button type="button" className="secondary-button" onClick={preview} disabled={previewing || (preferences.alarm_sound === "custom" && !customPath)}><Play size={14}/> Preview sound</button>
      {previewing && preferences.alarm_sound === "custom" && <button type="button" className="secondary-button" onClick={stopPreview}><Square size={13}/> Stop</button>}
    </div>
    <label className="alarm-volume-label">Volume <strong>{Math.round(volume * 100)}%</strong>
      <input type="range" min="0" max="1" step="0.05" value={volume} onChange={e => onChange({ alarm_volume: Number(e.target.value) })}/>
    </label>
    <label className="toggle-row"><span>Repeat alarm pattern</span><input type="checkbox" checked={preferences.alarm_repeat !== false} onChange={e => onChange({ alarm_repeat: e.target.checked })}/></label>
    <div className="custom-alarm-upload">
      <div><strong>My audio</strong><small>Upload MP3, WAV, OGG, M4A or AAC audio · maximum 5 MB. Choose it from the sound profile after upload.</small></div>
      <input ref={fileRef} type="file" accept="audio/*" onChange={upload} hidden/>
      <button type="button" className="secondary-button" onClick={() => fileRef.current?.click()} disabled={uploading}><Upload size={14}/>{uploading ? "Uploading…" : "Upload audio"}</button>
    </div>
    {customPath && <div className="custom-alarm-file"><CheckCircle2 size={15}/><span>{preferences.custom_alarm_name || "Custom alarm audio"}</span><button type="button" aria-label="Remove custom alarm audio" onClick={removeCustom} disabled={uploading}><Trash2 size={14}/></button></div>}
    <p className="alarm-audio-note">When Value Time is open, built-in and uploaded sounds can play in the app. For background notifications, the device uses its own notification sound and notification settings. Web apps cannot browse or select a phone’s private ringtone library or force a custom sound for system notifications. Use “Preview sound” to test the selected option.</p>
    {note && <p className="alarm-audio-feedback">{note}</p>}
  </section>;
}
