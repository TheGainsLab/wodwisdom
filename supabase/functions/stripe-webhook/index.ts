import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET");
const PRICE_ATHLETE = Deno.env.get("STRIPE_PRICE_ATHLETE");
const PRICE_GYM = Deno.env.get("STRIPE_PRICE_GYM");

const cryptoKey = await crypto.subtle.importKey(
  "raw",
  new TextEncoder().encode(STRIPE_WEBHOOK_SECRET),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign"]
);

async function verifyStripeSignature(payload: string, header: string): Promise<boolean> {
  const pairs = header.split(",").map(s => s.trim().split("="));
  const timestamp = pairs.find(p => p[0] === "t")?.[1];
  const sig = pairs.find(p => p[0] === "v1")?.[1];
  if (!timestamp || !sig) return false;
  const signedPayload = timestamp + "." + payload;
  const mac = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(signedPayload));
  const expected = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, "0")).join("");
  return expected === sig;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200 });

  try {
    const body = await req.text();
    const sig = req.headers.get("stripe-signature");
    if (!sig || !(await verifyStripeSignature(body, sig))) {
      return new Response("Invalid signature", { status: 400 });
    }

    const event = JSON.parse(body);
    const supa = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const email = session.customer_email || session.customer_details?.email;
        const customerId = session.customer;
        const subscriptionId = session.subscription;

        // Determine plan from line items
        const priceId = session.line_items?.data?.[0]?.price?.id || "";
        const isGym = priceId === PRICE_GYM;
        const role = isGym ? "owner" : "individual";

        // Find user by email and activate
        const { data: profiles } = await supa.from("profiles").select("id").eq("email", email).limit(1);
        if (profiles && profiles.length > 0) {
          await supa.from("profiles").update({
            subscription_status: "active",
            stripe_customer_id: customerId,
            role: role,
          }).eq("id", profiles[0].id);
        }
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object;
        const customerId = sub.customer;
        const status = sub.status; // active, past_due, canceled, unpaid
        const cancelAtPeriodEnd = sub.cancel_at_period_end;

        const subStatus = cancelAtPeriodEnd ? "canceling" : (status === "active" ? "active" : "past_due");

        await supa.from("profiles").update({
          subscription_status: subStatus,
        }).eq("stripe_customer_id", customerId);
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const customerId = sub.customer;

        await supa.from("profiles").update({
          subscription_status: "inactive",
        }).eq("stripe_customer_id", customerId);
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object;
        const customerId = invoice.customer;

        await supa.from("profiles").update({
          subscription_status: "active",
        }).eq("stripe_customer_id", customerId);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object;
        const customerId = invoice.customer;

        await supa.from("profiles").update({
          subscription_status: "past_due",
        }).eq("stripe_customer_id", customerId);
        break;
      }

      default:
        console.log("Unhandled event:", event.type);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Webhook error:", e.message);
    return new Response(JSON.stringify({ error: e.message }), { status: 400 });
  }
});
