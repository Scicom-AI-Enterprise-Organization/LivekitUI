import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ensureDb } from "@/lib/db";

interface ProviderNumber {
  number: string;
  friendlyName?: string;
  sid?: string;
  capabilities: { voice: boolean; sms: boolean };
}

async function fetchTwilioNumbers(): Promise<ProviderNumber[]> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return [];

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PageSize=100`,
    {
      headers: {
        Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
      },
    }
  );

  if (!res.ok) throw new Error(`Twilio API error: ${res.status}`);

  const data = await res.json();
  return (data.incoming_phone_numbers || []).map((n: Record<string, unknown>) => ({
    number: n.phone_number as string,
    friendlyName: (n.friendly_name as string) || undefined,
    sid: n.sid as string,
    capabilities: {
      voice: !!(n.capabilities as Record<string, boolean>)?.voice,
      sms: !!(n.capabilities as Record<string, boolean>)?.sms,
    },
  }));
}

async function fetchVonageNumbers(): Promise<ProviderNumber[]> {
  const key = process.env.VONAGE_API_KEY;
  const secret = process.env.VONAGE_API_SECRET;
  if (!key || !secret) return [];

  const res = await fetch(
    `https://rest.nexmo.com/account/numbers?api_key=${key}&api_secret=${secret}`,
  );

  if (!res.ok) throw new Error(`Vonage API error: ${res.status}`);

  const data = await res.json();
  return (data.numbers || []).map((n: Record<string, unknown>) => ({
    number: `+${n.msisdn}`,
    friendlyName: (n.country as string) || undefined,
    sid: n.msisdn as string,
    capabilities: {
      voice: ((n.features as string[]) || []).includes("VOICE"),
      sms: ((n.features as string[]) || []).includes("SMS"),
    },
  }));
}

async function fetchTelnyxNumbers(): Promise<ProviderNumber[]> {
  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) return [];

  const res = await fetch(
    "https://api.telnyx.com/v2/phone_numbers?page[size]=100",
    {
      headers: { Authorization: `Bearer ${apiKey}` },
    }
  );

  if (!res.ok) throw new Error(`Telnyx API error: ${res.status}`);

  const data = await res.json();
  return (data.data || []).map((n: Record<string, unknown>) => ({
    number: n.phone_number as string,
    friendlyName: (n.connection_name as string) || undefined,
    sid: n.id as string,
    capabilities: { voice: true, sms: true },
  }));
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.role === "member") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const { provider } = await request.json();

  let numbers: ProviderNumber[];
  try {
    switch (provider) {
      case "twilio":
        numbers = await fetchTwilioNumbers();
        break;
      case "vonage":
        numbers = await fetchVonageNumbers();
        break;
      case "telnyx":
        numbers = await fetchTelnyxNumbers();
        break;
      default:
        return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to fetch from ${provider}: ${(err as Error).message}` },
      { status: 502 }
    );
  }

  const db = await ensureDb();
  let imported = 0;
  let skipped = 0;

  for (const n of numbers) {
    const existing = await db.findPhoneNumberByNumber(n.number);
    if (existing) {
      skipped++;
      continue;
    }
    await db.createPhoneNumber(
      n.number,
      n.friendlyName || null,
      provider,
      n.sid || null,
      JSON.stringify(n.capabilities)
    );
    imported++;
  }

  return NextResponse.json({ imported, skipped, total: numbers.length });
}
