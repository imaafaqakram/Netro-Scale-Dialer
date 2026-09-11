import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
    let supabaseResponse = NextResponse.next({
        request,
    })

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll()
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
                    supabaseResponse = NextResponse.next({
                        request,
                    })
                    cookiesToSet.forEach(({ name, value, options }) =>
                        supabaseResponse.cookies.set(name, value, options)
                    )
                },
            },
        }
    )

    // Allow SignalWire webhook requests and Mobile API routes through without browser auth
    // These routes come from SignalWire servers, background webhooks, or mobile clients with Bearer tokens
    const pathname = request.nextUrl.pathname
    if (pathname.startsWith('/api/signalwire/') || pathname.startsWith('/api/mobile')) {
        return supabaseResponse
    }

    const {
        data: { user },
    } = await supabase.auth.getUser()

    // Allow all API routes to handle their own authentication/response format
    if (pathname.startsWith('/api/')) {
        return supabaseResponse
    }

    // Redirect to login if not authenticated and not on login page
    if (!user && !pathname.startsWith('/login')) {
        const url = request.nextUrl.clone()
        url.pathname = '/login'
        return NextResponse.redirect(url)
    }

    // Redirect to calls if authenticated and on login page
    if (user && request.nextUrl.pathname.startsWith('/login')) {
        const url = request.nextUrl.clone()
        url.pathname = '/calls'
        return NextResponse.redirect(url)
    }

    return supabaseResponse
}

export const config = {
    matcher: [
        '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ],
}
