import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const providers = [];

  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    providers.push({ id: "twilio", name: "Twilio", configured: true });
  }

  if (process.env.VONAGE_API_KEY && process.env.VONAGE_API_SECRET) {
    providers.push({ id: "vonage", name: "Vonage", configured: true });
  }

  if (process.env.TELNYX_API_KEY) {
    providers.push({ id: "telnyx", name: "Telnyx", configured: true });
  }

  return NextResponse.json({ providers });
}
