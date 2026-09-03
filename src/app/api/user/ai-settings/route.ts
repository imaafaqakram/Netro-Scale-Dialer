import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_AI_CONFIG, generateInitialGreeting } from '@/lib/ai/prompts';

interface UserAISettings {
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

const DEFAULT_AI_SETTINGS: UserAISettings = {
    replicate_api_token: '',
    cerebras_api_key: '',
    deepgram_api_key: '',
    cartesia_api_key: '',
    google_sheet_id: '',
    ai_voice: 'Polly.Joanna',
    greeting_message: generateInitialGreeting(),
    system_prompt: DEFAULT_SYSTEM_PROMPT,
    transfer_keywords: DEFAULT_AI_CONFIG.transferKeywords.join(', '),
    max_turns: 6,
};

export async function GET() {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json(DEFAULT_AI_SETTINGS);
        }

        const admin = createSupabaseAdmin();
        const { data: adminUser } = await admin.auth.admin.getUserById(user.id);
        const savedSettings = adminUser?.user?.user_metadata?.ai_settings || user.user_metadata?.ai_settings;

        if (savedSettings) {
            return NextResponse.json({
                ...DEFAULT_AI_SETTINGS,
                ...savedSettings,
            });
        }

        return NextResponse.json(DEFAULT_AI_SETTINGS);
    } catch (e) {
        console.error('[AI Settings] Fetch error:', e);
        return NextResponse.json(DEFAULT_AI_SETTINGS);
    }
}

export async function PUT(request: Request) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const admin = createSupabaseAdmin();

        // 1. Update in Supabase Auth user_metadata (permanent across devices/sessions)
        const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(user.id, {
            user_metadata: {
                ...(user.user_metadata || {}),
                ai_settings: body,
            }
        });

        if (updateError) {
            console.error('[AI Settings] Admin update error:', updateError);
        }

        return NextResponse.json({ success: true, settings: body });
    } catch (error) {
        console.error('[AI Settings] Update error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
