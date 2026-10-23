-- =============================================================================
-- Migration: 0014_social_chat_support.sql
-- Milestone: Build Response 5 (Migrations IV — Verified Reviews, Favourites, Chat & Support)
-- Tables:    reviews, favourites, chats, chat_messages, support_threads, support_messages
-- References: Master Guide File 13 (§13.3), File 20, File 22 (§22.3, §22.6), ADR-0006
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN (
    'customer_to_vendor', 'customer_to_rider', 'rider_to_vendor', 'vendor_to_customer'
  )),
  vendor_id uuid REFERENCES public.vendors(id) ON DELETE CASCADE,
  rider_id uuid REFERENCES public.riders(id) ON DELETE CASCADE,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  aspect_tags text[] NOT NULL DEFAULT '{}'::text[],
  comment text CHECK (comment IS NULL OR char_length(comment) <= 1000),
  photo_urls text[] NOT NULL DEFAULT '{}'::text[] CHECK (cardinality(photo_urls) <= 4),
  vendor_reply text CHECK (vendor_reply IS NULL OR char_length(vendor_reply) <= 600),
  vendor_replied_at timestamptz,
  moderation_status text NOT NULL DEFAULT 'visible'
    CHECK (moderation_status IN ('visible', 'flagged', 'hidden')),
  moderation_note text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (order_id, direction)
);

CREATE INDEX IF NOT EXISTS reviews_vendor_visible_idx
  ON public.reviews (vendor_id, created_at DESC) WHERE direction = 'customer_to_vendor' AND moderation_status = 'visible';
CREATE INDEX IF NOT EXISTS reviews_rider_visible_idx
  ON public.reviews (rider_id, created_at DESC) WHERE direction = 'customer_to_rider' AND moderation_status = 'visible';
COMMENT ON TABLE public.reviews IS
  'Verified completed-order ratings & reviews with vendor reply and automatic vendor/rider aggregate updates (File 22 §22.6).';

CREATE OR REPLACE FUNCTION public.validate_and_sync_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ord record;
  v_target_vendor uuid := coalesce(NEW.vendor_id, OLD.vendor_id);
  v_target_rider uuid := coalesce(NEW.rider_id, OLD.rider_id);
BEGIN
  IF TG_WHEN = 'BEFORE' THEN
    SELECT id, status, customer_id, vendor_id, rider_id INTO v_ord FROM public.orders WHERE id = NEW.order_id;
    IF NOT FOUND OR v_ord.status <> 'DELIVERED' THEN
      RAISE EXCEPTION 'REVIEW_ORDER_NOT_COMPLETED: only DELIVERED orders can be reviewed' USING ERRCODE = '55000';
    END IF;
    IF NEW.direction IN ('customer_to_vendor', 'customer_to_rider') AND NEW.reviewer_id <> v_ord.customer_id THEN
      RAISE EXCEPTION 'REVIEW_NOT_BUYER: reviewer must be the verified customer of order %', NEW.order_id USING ERRCODE = '42501';
    END IF;
    NEW.vendor_id := coalesce(NEW.vendor_id, v_ord.vendor_id);
    NEW.rider_id := coalesce(NEW.rider_id, v_ord.rider_id);
    RETURN NEW;
  END IF;

  IF v_target_vendor IS NOT NULL THEN
    UPDATE public.vendors SET
      rating_avg = coalesce((
        SELECT round(avg(rating)::numeric, 2) FROM public.reviews
        WHERE vendor_id = v_target_vendor AND direction = 'customer_to_vendor' AND moderation_status = 'visible'
      ), 0.00),
      rating_count = (
        SELECT count(*)::int FROM public.reviews
        WHERE vendor_id = v_target_vendor AND direction = 'customer_to_vendor' AND moderation_status = 'visible'
      )
    WHERE id = v_target_vendor;
  END IF;

  IF v_target_rider IS NOT NULL THEN
    UPDATE public.riders SET
      rating_avg = coalesce((
        SELECT round(avg(rating)::numeric, 2) FROM public.reviews
        WHERE rider_id = v_target_rider AND direction = 'customer_to_rider' AND moderation_status = 'visible'
      ), 0.00),
      rating_count = (
        SELECT count(*)::int FROM public.reviews
        WHERE rider_id = v_target_rider AND direction = 'customer_to_rider' AND moderation_status = 'visible'
      )
    WHERE id = v_target_rider;
  END IF;
  RETURN NULL;
END;
$$;
COMMENT ON FUNCTION public.validate_and_sync_review() IS
  'Enforces verified DELIVERED buyer law BEFORE INSERT and refreshes vendor/rider rating aggregates AFTER write.';

DROP TRIGGER IF EXISTS reviews_before_insert_guard ON public.reviews;
CREATE TRIGGER reviews_before_insert_guard BEFORE INSERT ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.validate_and_sync_review();
DROP TRIGGER IF EXISTS reviews_after_write_sync ON public.reviews;
CREATE TRIGGER reviews_after_write_sync AFTER INSERT OR UPDATE OR DELETE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.validate_and_sync_review();
DROP TRIGGER IF EXISTS reviews_set_updated_at ON public.reviews;
CREATE TRIGGER reviews_set_updated_at BEFORE UPDATE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.favourites (
  customer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (customer_id, vendor_id)
);
CREATE INDEX IF NOT EXISTS favourites_customer_idx ON public.favourites (customer_id, created_at DESC);
COMMENT ON TABLE public.favourites IS 'Customer saved favourite kitchens across all 3 tracks.';

CREATE TABLE IF NOT EXISTS public.chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  pair_kind text NOT NULL CHECK (pair_kind IN ('customer_rider', 'customer_vendor', 'rider_vendor')),
  is_locked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (order_id, pair_kind)
);
COMMENT ON TABLE public.chats IS
  'Order-scoped conversation rooms (customer<->rider, customer<->vendor, rider<->vendor per File 22 §22.3).';
DROP TRIGGER IF EXISTS chats_set_updated_at ON public.chats;
CREATE TRIGGER chats_set_updated_at BEFORE UPDATE ON public.chats FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body text CHECK (body IS NULL OR char_length(body) <= 1000),
  media_public_id text,
  voice_duration_sec smallint CHECK (voice_duration_sec IS NULL OR voice_duration_sec BETWEEN 1 AND 60),
  contains_phone_or_link boolean NOT NULL DEFAULT false,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT chat_messages_content_present CHECK (
    (body IS NOT NULL AND char_length(btrim(body)) > 0) OR media_public_id IS NOT NULL
  )
);
CREATE INDEX IF NOT EXISTS chat_messages_chat_time_idx ON public.chat_messages (chat_id, created_at ASC);
COMMENT ON TABLE public.chat_messages IS
  'Persisted chat messages with phone/link shield flag, <=60s voice note cap, and 24h post-terminal lock guard.';

CREATE OR REPLACE FUNCTION public.enforce_chat_message_window()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_chat record;
BEGIN
  SELECT c.is_locked, o.status, coalesce(o.delivered_at, o.cancelled_at) AS ended_at
  INTO v_chat
  FROM public.chats AS c
  JOIN public.orders AS o ON o.id = c.order_id
  WHERE c.id = NEW.chat_id;

  IF v_chat.is_locked OR (v_chat.ended_at IS NOT NULL AND clock_timestamp() > (v_chat.ended_at + INTERVAL '24 hours')) THEN
    RAISE EXCEPTION 'CHAT_READ_ONLY: order chat locks 24 hours after completion/cancellation' USING ERRCODE = '55000';
  END IF;

  IF NEW.body IS NOT NULL AND NEW.body ~ '(https?://|01[3-9][0-9]{8})' THEN
    NEW.contains_phone_or_link := true;
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.enforce_chat_message_window() IS
  'Enforces File 22 §22.3 24-hour post-terminal read-only chat lock and flags phone numbers/external links.';

DROP TRIGGER IF EXISTS chat_messages_window_guard ON public.chat_messages;
CREATE TRIGGER chat_messages_window_guard BEFORE INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_chat_message_window();

CREATE TABLE IF NOT EXISTS public.support_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  requester_role text NOT NULL CHECK (requester_role IN ('customer', 'vendor_owner', 'vendor_staff', 'rider')),
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  category text NOT NULL CHECK (char_length(btrim(category)) BETWEEN 2 AND 64),
  subject text NOT NULL CHECK (char_length(btrim(subject)) BETWEEN 3 AND 160),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending_user', 'resolved', 'closed')),
  assigned_admin_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  sla_due_at timestamptz NOT NULL DEFAULT (clock_timestamp() + INTERVAL '4 hours'),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS support_threads_status_sla_idx ON public.support_threads (status, priority, sla_due_at ASC);
COMMENT ON TABLE public.support_threads IS 'Unified Customer, Partner & Rider support tickets with SLA timer (Domain 8).';
DROP TRIGGER IF EXISTS support_threads_set_updated_at ON public.support_threads;
CREATE TRIGGER support_threads_set_updated_at BEFORE UPDATE ON public.support_threads FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.support_threads(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_internal_note boolean NOT NULL DEFAULT false,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  attachment_public_ids text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS support_messages_thread_time_idx ON public.support_messages (thread_id, created_at ASC);
COMMENT ON TABLE public.support_messages IS 'Support thread messages and admin-only internal notes with Cloudinary authenticated attachments.';

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews FORCE ROW LEVEL SECURITY;
ALTER TABLE public.favourites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.favourites FORCE ROW LEVEL SECURITY;
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chats FORCE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE public.support_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_threads FORCE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages FORCE ROW LEVEL SECURITY;
