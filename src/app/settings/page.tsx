'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase';
import { AppLayout } from '@/components/Layout';
import { useAccessibility } from '@/contexts/AccessibilityContext';
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_AI_CONFIG, generateInitialGreeting } from '@/lib/ai/prompts';
import type { AccessibilityPreferences } from '@/types';
import styles from './page.module.css';

interface PhoneNumber {
    id: string;
    phone_number: string;
    friendly_name: string | null;
    is_default: boolean;
}

interface VoiceSettings {
    call_recording_enabled: boolean;
    voicemail_enabled: boolean;
    voicemail_greeting_url: string | null;
}

interface AISettings {
    replicate_api_token: string;
    cerebras_api_key: string;
    deepgram_api_key: string;
    cartesia_api_key: string;
    google_sheet_id: string;
    ai_voice: string;
    greeting_message: string;
    system_prompt: string;
    transfer_keywords: string;
    max_turns: number;
}

export default function SettingsPage() {
    const { preferences: accessibilityPreferences, setTheme } = useAccessibility();
    const [user, setUser] = useState<{ email?: string | null } | null>(null);
    const [numbers, setNumbers] = useState<PhoneNumber[]>([]);
    const [selectedNumber, setSelectedNumber] = useState<string>('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // Voice settings
    const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>({
        call_recording_enabled: false,
        voicemail_enabled: false,
        voicemail_greeting_url: null,
    });
    const [savingVoice, setSavingVoice] = useState(false);

    // AI Settings
    const [aiSettings, setAiSettings] = useState<AISettings>({
        replicate_api_token: '',
        cerebras_api_key: '',
        deepgram_api_key: '',
        cartesia_api_key: '',
        google_sheet_id: '',
        ai_voice: 'Polly.Danielle-Neural',
        greeting_message: generateInitialGreeting(),
        system_prompt: DEFAULT_SYSTEM_PROMPT,
        transfer_keywords: DEFAULT_AI_CONFIG.transferKeywords.join(', '),
        max_turns: 6,
    });
    const [savingAI, setSavingAI] = useState(false);
    const [aiSavedSuccess, setAiSavedSuccess] = useState(false);

    // Fetch user and their phone numbers
    useEffect(() => {
        async function fetchData() {
            const supabase = createClient();

            // Get user
            const { data: { user } } = await supabase.auth.getUser();
            setUser(user);

            // Fetch phone numbers
            try {
                const res = await fetch('/api/user/numbers');
                const data = await res.json();

                if (data.numbers) {
                    setNumbers(data.numbers);
                    const defaultNum = data.numbers.find((n: PhoneNumber) => n.is_default);
                    setSelectedNumber(defaultNum?.phone_number || data.numbers[0]?.phone_number || '');
                }
            } catch (err) {
                console.error('Failed to fetch numbers:', err);
            }

            // Fetch voice settings
            try {
                const res = await fetch('/api/user/voice-settings');
                const data = await res.json();
                if (!data.error) {
                    setVoiceSettings(data);
                }
            } catch (err) {
                console.error('Failed to fetch voice settings:', err);
            }

            // Fetch AI settings from server (source of truth — API keys are never cached
            // client-side in localStorage, since that would leave them readable in
            // plaintext to any script or anyone with access to the browser profile).
            try {
                const res = await fetch('/api/user/ai-settings');
                const data = await res.json();
                if (data && !data.error) {
                    setAiSettings(prev => ({ ...prev, ...data }));
                }
            } catch (err) {
                console.error('Failed to fetch AI settings:', err);
            }

            setLoading(false);
        }

        fetchData();
    }, []);

    // Update default number
    const handleNumberChange = async (phoneNumber: string) => {
        setSelectedNumber(phoneNumber);
        setSaving(true);

        try {
            await fetch('/api/user/numbers', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phoneNumber }),
            });
        } catch (err) {
            console.error('Failed to update default:', err);
        } finally {
            setSaving(false);
        }
    };

    // Update a voice setting
    const handleVoiceSettingChange = async (key: keyof VoiceSettings, value: boolean) => {
        const newSettings = { ...voiceSettings, [key]: value };
        setVoiceSettings(newSettings);
        setSavingVoice(true);

        try {
            await fetch('/api/user/voice-settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ [key]: value }),
            });
        } catch (err) {
            console.error('Failed to update voice setting:', err);
            setVoiceSettings(voiceSettings);
        } finally {
            setSavingVoice(false);
        }
    };

    // Save AI Settings
    const handleSaveAISettings = async () => {
        setSavingAI(true);
        setAiSavedSuccess(false);
        try {
            // Save in Supabase Auth user_metadata (server-side only — not cached client-side)
            await fetch('/api/user/ai-settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(aiSettings),
            });
            setAiSavedSuccess(true);
            setTimeout(() => setAiSavedSuccess(false), 4000);
        } catch (err) {
            console.error('Failed to save AI settings:', err);
        } finally {
            setSavingAI(false);
        }
    };

    const handleLoadDefaultTemplate = () => {
        setAiSettings(prev => ({
            ...prev,
            greeting_message: generateInitialGreeting(),
            system_prompt: DEFAULT_SYSTEM_PROMPT,
            transfer_keywords: DEFAULT_AI_CONFIG.transferKeywords.join(', '),
        }));
    };

    return (
        <AppLayout user={user || undefined}>
            <div className={styles.container}>
                <div className={styles.header}>
                    <h1 className={styles.title}>Settings</h1>
                </div>

                <div className={styles.sections}>
                    {/* AI Voice Agent & Knowledge Base */}
                    <section className={styles.section}>
                        <div className={styles.sectionHeaderFlex}>
                            <h2 className={styles.sectionTitle}>🤖 AI Voice Agent & Script Engine</h2>
                            <button
                                className={styles.templateBtn}
                                onClick={handleLoadDefaultTemplate}
                                title="Reset to the default greeting, prompt, and transfer keywords"
                            >
                                📋 Reset to Default Template
                            </button>
                        </div>
                        <div className={styles.card}>
                            {/* API Keys */}
                            <div className={styles.formRow}>
                                <div className={styles.formGroup}>
                                    <label className={styles.settingLabel}>Replicate API Token (Llama 3)</label>
                                    <input
                                        type="password"
                                        className={styles.inputField}
                                        placeholder="r8_xxxxxxxxxxxxxxxxxxxx"
                                        value={aiSettings.replicate_api_token}
                                        onChange={(e) => setAiSettings({ ...aiSettings, replicate_api_token: e.target.value })}
                                    />
                                    <span className={styles.inputHelp}>Used for Llama 3 70B conversational reasoning.</span>
                                </div>
                                <div className={styles.formGroup}>
                                    <label className={styles.settingLabel}>Cerebras API Key (Ultra-Fast Inference)</label>
                                    <input
                                        type="password"
                                        className={styles.inputField}
                                        placeholder="csk-xxxxxxxxxxxxxxxxxxxx"
                                        value={aiSettings.cerebras_api_key}
                                        onChange={(e) => setAiSettings({ ...aiSettings, cerebras_api_key: e.target.value })}
                                    />
                                    <span className={styles.inputHelp}>Primary fast LLM engine with Replicate fallback.</span>
                                </div>
                            </div>

                            <div className={styles.formRow}>
                                <div className={styles.formGroup}>
                                    <label className={styles.settingLabel}>Deepgram API Key (Call Transcription)</label>
                                    <input
                                        type="password"
                                        className={styles.inputField}
                                        placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                                        value={aiSettings.deepgram_api_key}
                                        onChange={(e) => setAiSettings({ ...aiSettings, deepgram_api_key: e.target.value })}
                                    />
                                    <span className={styles.inputHelp}>Transcribes call recordings &amp; voicemails for the CRM sheet. Falls back to a self-hosted Whisper endpoint if configured server-side.</span>
                                </div>
                                <div className={styles.formGroup}>
                                    <label className={styles.settingLabel}>Google Sheet ID (CRM)</label>
                                    <input
                                        type="text"
                                        className={styles.inputField}
                                        placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
                                        value={aiSettings.google_sheet_id}
                                        onChange={(e) => setAiSettings({ ...aiSettings, google_sheet_id: e.target.value })}
                                    />
                                    <span className={styles.inputHelp}>The ID from your sheet&apos;s URL — share the sheet with the service account email first. See SETUP_GUIDE.md.</span>
                                </div>
                            </div>

                            {/* Voice Picker */}
                            <div className={styles.setting}>
                                <div className={styles.settingInfo}>
                                    <span className={styles.settingLabel}>AI Voice Actor (Polly Neural)</span>
                                    <span className={styles.settingDesc}>Natural neural voice used during caller dialogue</span>
                                </div>
                                <select
                                    className={styles.select}
                                    value={aiSettings.ai_voice}
                                    onChange={(e) => setAiSettings({ ...aiSettings, ai_voice: e.target.value })}
                                >
                                    <option value="Polly.Joanna">Joanna (US Female - Natural & Conversational)</option>
                                    <option value="Polly.Salli">Salli (US Female - Warm & Authoritative)</option>
                                    <option value="Polly.Matthew">Matthew (US Male - Professional Executive)</option>
                                    <option value="Polly.Amy">Amy (UK Female - Professional)</option>
                                    <option value="alice">Alice (Standard Voice)</option>
                                </select>
                            </div>

                            {/* Transfer Keywords */}
                            <div className={styles.settingStacked}>
                                <div className={styles.settingInfo}>
                                    <span className={styles.settingLabel}>Transfer Trigger Keywords</span>
                                    <span className={styles.settingDesc}>Phrases that automatically bridge the live call to your softphone</span>
                                </div>
                                <input
                                    type="text"
                                    className={styles.inputFieldFull}
                                    value={aiSettings.transfer_keywords}
                                    onChange={(e) => setAiSettings({ ...aiSettings, transfer_keywords: e.target.value })}
                                    placeholder="speak to someone, human, representative, specialist, transfer"
                                />
                            </div>

                            {/* Opening Greeting */}
                            <div className={styles.settingStacked}>
                                <div className={styles.settingInfo}>
                                    <span className={styles.settingLabel}>Opening Greeting</span>
                                    <span className={styles.settingDesc}>The first thing the AI says when the customer picks up</span>
                                </div>
                                <textarea
                                    className={styles.textareaPrompt}
                                    rows={3}
                                    value={aiSettings.greeting_message}
                                    onChange={(e) => setAiSettings({ ...aiSettings, greeting_message: e.target.value })}
                                />
                            </div>

                            {/* System Prompt & FAQ Knowledge Base */}
                            <div className={styles.settingStacked}>
                                <div className={styles.settingInfo}>
                                    <span className={styles.settingLabel}>AI System Prompt & FAQ Knowledge Base</span>
                                    <span className={styles.settingDesc}>Explain the purpose of your calls and paste in your FAQs — the AI will use this to answer caller questions and decide when to transfer</span>
                                </div>
                                <textarea
                                    className={styles.textareaPrompt}
                                    rows={14}
                                    value={aiSettings.system_prompt}
                                    onChange={(e) => setAiSettings({ ...aiSettings, system_prompt: e.target.value })}
                                />
                            </div>

                            {/* Save AI Settings Button */}
                            <div className={styles.cardActions}>
                                {aiSavedSuccess && <span className={styles.saveSuccessMsg}>✓ AI Settings Saved!</span>}
                                <button
                                    className={styles.saveAIBtn}
                                    onClick={handleSaveAISettings}
                                    disabled={savingAI}
                                >
                                    {savingAI ? 'Saving...' : 'Save AI Configuration'}
                                </button>
                            </div>
                        </div>
                    </section>

                    {/* Phone Number Settings */}
                    <section className={styles.section}>
                        <h2 className={styles.sectionTitle}>Phone Number</h2>
                        <div className={styles.card}>
                            <div className={styles.setting}>
                                <div className={styles.settingInfo}>
                                    <span className={styles.settingLabel}>Default Caller ID</span>
                                    <span className={styles.settingDesc}>Number used for outgoing calls</span>
                                </div>
                                {loading ? (
                                    <span className={styles.loading}>Loading...</span>
                                ) : numbers.length === 0 ? (
                                    <span className={styles.noNumbers}>No numbers assigned</span>
                                ) : (
                                    <select
                                        className={styles.select}
                                        value={selectedNumber}
                                        onChange={(e) => handleNumberChange(e.target.value)}
                                        disabled={saving}
                                    >
                                        {numbers.map((num) => (
                                            <option key={num.id} value={num.phone_number}>
                                                {num.friendly_name || num.phone_number}
                                            </option>
                                        ))}
                                    </select>
                                )}
                            </div>
                        </div>
                    </section>

                    {/* Voice Features */}
                    <section className={styles.section}>
                        <h2 className={styles.sectionTitle}>
                            Voice Features
                            {savingVoice && <span className={styles.savingIndicator}> Saving...</span>}
                        </h2>
                        <div className={styles.card}>
                            <div className={styles.setting}>
                                <div className={styles.settingInfo}>
                                    <span className={styles.settingLabel}>Call Recording</span>
                                    <span className={styles.settingDesc}>Automatically record incoming calls</span>
                                </div>
                                <label className={styles.toggle}>
                                    <input
                                        type="checkbox"
                                        className={styles.toggleInput}
                                        checked={voiceSettings.call_recording_enabled}
                                        onChange={(e) => handleVoiceSettingChange('call_recording_enabled', e.target.checked)}
                                        disabled={loading || numbers.length === 0}
                                    />
                                    <span className={styles.toggleSlider}></span>
                                </label>
                            </div>
                            <div className={styles.setting}>
                                <div className={styles.settingInfo}>
                                    <span className={styles.settingLabel}>Voicemail</span>
                                    <span className={styles.settingDesc}>Send unanswered calls to voicemail</span>
                                </div>
                                <label className={styles.toggle}>
                                    <input
                                        type="checkbox"
                                        className={styles.toggleInput}
                                        checked={voiceSettings.voicemail_enabled}
                                        onChange={(e) => handleVoiceSettingChange('voicemail_enabled', e.target.checked)}
                                        disabled={loading || numbers.length === 0}
                                    />
                                    <span className={styles.toggleSlider}></span>
                                </label>
                            </div>
                        </div>
                    </section>

                    {/* Appearance */}
                    <section className={styles.section}>
                        <h2 className={styles.sectionTitle}>Appearance</h2>
                        <div className={styles.card}>
                            <div className={styles.setting}>
                                <div className={styles.settingInfo}>
                                    <span className={styles.settingLabel}>Theme</span>
                                    <span className={styles.settingDesc}>Choose your preferred color theme</span>
                                </div>
                                <select
                                    className={styles.select}
                                    value={accessibilityPreferences.theme}
                                    onChange={(e) => setTheme(e.target.value as AccessibilityPreferences['theme'])}
                                >
                                    <option value="light">Light</option>
                                    <option value="dark">Dark</option>
                                    <option value="system">System</option>
                                </select>
                            </div>
                        </div>
                    </section>

                    {/* About */}
                    <section className={styles.section}>
                        <h2 className={styles.sectionTitle}>About</h2>
                        <div className={styles.card}>
                            <div className={styles.about}>
                                <p><strong>Netro Scale v2.0</strong></p>
                                <p className={styles.aboutDesc}>AI voice agent &amp; telephony system powered by Twilio, Replicate, Cerebras, and Deepgram</p>
                            </div>
                        </div>
                    </section>
                </div>
            </div>
        </AppLayout>
    );
}
