import { NextRequest, NextResponse } from "next/server";

// This endpoint receives webhook events from the LiveKit server.
// In production, you should verify the webhook signature using the
// LiveKit SDK's WebhookReceiver to ensure the request is authentic:
//
//   import { WebhookReceiver } from "livekit-server-sdk";
//   const receiver = new WebhookReceiver(apiKey, apiSecret);
//   const event = await receiver.receive(body, authHeader);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // TODO: Verify webhook signature in production
    // const authHeader = request.headers.get("authorization") ?? "";

    console.log("[LiveKit Webhook] Received event:", JSON.stringify(body, null, 2));

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[LiveKit Webhook] Error processing event:", error);
    return NextResponse.json(
      { error: "Failed to process webhook" },
      { status: 500 }
    );
  }
}
