/**
 * @file workers/api/test/_helpers/pglite-api-ops.mjs
 * @description Real PostgreSQL 16 (`PGlite` WASM) query & stored-procedure bindings for `W1 undal-api`
 * Part 2 (`Build Response 7`) — zero mocked SQL results anywhere.
 */

export function createPgliteOpsMethods(db, resolveZone) {
  return {
    async listCustomerAddresses(profileId) {
      return (
        await db.query(
          'SELECT * FROM public.customer_addresses WHERE profile_id = $1 ORDER BY is_default DESC, created_at DESC',
          [profileId],
        )
      ).rows;
    },
    async saveCustomerAddress(input) {
      const zone = await resolveZone(input.lat, input.lng);
      const zoneId = zone.in_service_area === true ? zone.zone_id : null;
      if (input.isDefault) {
        await db.query('UPDATE public.customer_addresses SET is_default = false WHERE profile_id = $1 AND is_default = true', [
          input.profileId,
        ]);
      }
      if (input.addressId) {
        return (
          await db.query(
            `UPDATE public.customer_addresses
             SET label = $3, lat = $4, lng = $5, address_text = $6, delivery_instructions = $7, zone_id = $8, is_default = $9
             WHERE id = $1 AND profile_id = $2 RETURNING *`,
            [
              input.addressId, input.profileId, input.label, input.lat, input.lng,
              input.addressText, input.deliveryInstructions, zoneId, input.isDefault,
            ],
          )
        ).rows[0];
      }
      return (
        await db.query(
          `INSERT INTO public.customer_addresses (
             profile_id, label, lat, lng, geohash, address_text, delivery_instructions, zone_id, is_default
           ) VALUES ($1,$2,$3,$4,'',$5,$6,$7,$8) RETURNING *`,
          [
            input.profileId, input.label, input.lat, input.lng,
            input.addressText, input.deliveryInstructions, zoneId, input.isDefault,
          ],
        )
      ).rows[0];
    },
    async deleteCustomerAddress(profileId, addressId) {
      return (
        await db.query('DELETE FROM public.customer_addresses WHERE id = $1 AND profile_id = $2 RETURNING id', [
          addressId, profileId,
        ])
      ).rows.length > 0;
    },
    async listFavourites(customerId) {
      return (await db.query(
        `SELECT f.vendor_id,
                jsonb_build_object(
                  'id', pvc.id, 'brand_name', pvc.brand_name, 'brand_name_bn', pvc.brand_name_bn,
                  'slug', pvc.slug, 'public_area_label', pvc.public_area_label,
                  'logo_url', pvc.logo_url, 'cover_url', pvc.cover_url,
                  'rating_avg', pvc.rating_avg, 'rating_count', pvc.rating_count
                ) AS vendor
         FROM public.favourites f
         JOIN public.public_vendor_cards pvc ON pvc.id = f.vendor_id
         WHERE f.customer_id = $1 ORDER BY f.created_at DESC`,
        [customerId],
      )).rows;
    },
    async toggleFavourite(customerId, vendorId) {
      const del = await db.query('DELETE FROM public.favourites WHERE customer_id = $1 AND vendor_id = $2 RETURNING vendor_id', [
        customerId, vendorId,
      ]);
      if (del.rows.length > 0) return { is_favourite: false };
      await db.query('INSERT INTO public.favourites (customer_id, vendor_id) VALUES ($1, $2)', [customerId, vendorId]);
      return { is_favourite: true };
    },
    async listAvailableVouchers(customerId) {
      return (
        await db.query(
          `SELECT v.id, v.code, v.title_en, v.title_bn, v.kind, v.value_num, v.cap_poisha,
                  v.min_order_poisha, v.ends_at
           FROM public.vouchers AS v
           WHERE v.is_active = true AND clock_timestamp() >= v.starts_at AND clock_timestamp() < v.ends_at
             AND v.budget_spent_poisha < v.budget_cap_poisha
             AND (SELECT count(*) FROM public.voucher_redemptions AS vr
                  WHERE vr.voucher_id = v.id AND vr.customer_id = $1) < v.max_uses_per_user
             AND (v.first_order_only = false OR NOT EXISTS (
                  SELECT 1 FROM public.orders AS o WHERE o.customer_id = $1
             ))
           ORDER BY v.ends_at ASC LIMIT 50`,
          [customerId],
        )
      ).rows;
    },

    async getCartWithItems(customerId) {
      const cart = (await db.query('SELECT * FROM public.carts WHERE customer_id = $1 LIMIT 1', [customerId])).rows[0] ?? null;
      if (!cart) return { cart: null, items: [] };
      const items = (await db.query('SELECT * FROM public.cart_items WHERE cart_id = $1 ORDER BY created_at ASC', [cart.id])).rows;
      return { cart, items };
    },

    async upsertCartSession(input) {
      const existing = await this.getCartWithItems(input.customerId);
      let clearedPrevious = false;
      if (existing.cart && existing.cart.vendor_id !== input.vendorId) {
        if (!input.confirmClear && existing.items.length > 0) {
          throw new Error('CART_VENDOR_CONFLICT: basket already contains items from another kitchen');
        }
        await db.query('DELETE FROM public.carts WHERE customer_id = $1', [input.customerId]);
        clearedPrevious = true;
      }
      const cart = (
        await db.query(
          `INSERT INTO public.carts (
             customer_id, vendor_id, address_id, fulfilment, tip_poisha, cutlery_requested, customer_note, change_for_poisha
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (customer_id) DO UPDATE SET
             vendor_id = EXCLUDED.vendor_id, address_id = EXCLUDED.address_id, fulfilment = EXCLUDED.fulfilment,
             tip_poisha = EXCLUDED.tip_poisha, cutlery_requested = EXCLUDED.cutlery_requested,
             customer_note = EXCLUDED.customer_note, change_for_poisha = EXCLUDED.change_for_poisha
           RETURNING *`,
          [
            input.customerId, input.vendorId, input.addressId, input.fulfilment,
            input.tipPoisha, input.cutleryRequested, input.customerNote, input.changeForPoisha,
          ],
        )
      ).rows[0];
      return { cart, clearedPrevious };
    },

    async mutateCartItem(input) {
      const state = await this.getCartWithItems(input.customerId);
      if (!state.cart) throw new Error('CART_EMPTY: initialize cart first');
      await db.query(
        'DELETE FROM public.cart_items WHERE cart_id = $1 AND menu_item_id = $2 AND variant_id IS NOT DISTINCT FROM $3',
        [state.cart.id, input.menuItemId, input.variantId],
      );
      if (input.qty > 0) {
        const mi = (await db.query('SELECT price_poisha FROM public.menu_items WHERE id = $1', [input.menuItemId])).rows[0];
        if (!mi) throw new Error('ITEM_UNAVAILABLE: menu item missing');
        await db.query(
          `INSERT INTO public.cart_items (cart_id, menu_item_id, variant_id, qty, selections, unit_snapshot_poisha, note)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
          [state.cart.id, input.menuItemId, input.variantId, input.qty, JSON.stringify(input.selections), mi.price_poisha, input.note],
        );
      }
      const next = await this.getCartWithItems(input.customerId);
      return { cart: next.cart, items: next.items };
    },

    async setCartVoucher(customerId, voucherCode) {
      if (voucherCode) {
        const v = (await db.query('SELECT id FROM public.vouchers WHERE code = $1 AND is_active = true', [voucherCode])).rows[0];
        if (!v) throw new Error('VOUCHER_INVALID: unknown voucher');
      }
      const row = (
        await db.query('UPDATE public.carts SET voucher_code = $2 WHERE customer_id = $1 RETURNING *', [customerId, voucherCode])
      ).rows[0];
      if (!row) throw new Error('CART_EMPTY: no active cart');
      return row;
    },

    async validateCartPricing(customerId, isPriority) {
      return (
        await db.query('SELECT public.quote_customer_cart($1,0,1,$2) AS quote', [customerId, isPriority])
      ).rows[0].quote;
    },

    async placeOrder(input) {
      return (
        await db.query('SELECT public.place_order($1,$2,$3,0,1,$4) AS data', [
          input.customerId,
          input.idempotencyKey,
          input.expectedCodPoisha,
          input.isPriority,
        ])
      ).rows[0].data;
    },

    async listActorOrders(profileId, role, limit) {
      if (role === 'admin') return (await db.query('SELECT * FROM public.orders ORDER BY placed_at DESC LIMIT $1', [limit])).rows;
      if (role === 'vendor_owner' || role === 'vendor_staff') {
        const op = await this.getOperatorVendor(profileId);
        return op ? (await db.query('SELECT * FROM public.orders WHERE vendor_id = $1 ORDER BY placed_at DESC LIMIT $2', [op.vendor.id, limit])).rows : [];
      }
      if (role === 'rider') {
        return (
          await db.query(
            'SELECT o.* FROM public.orders o JOIN public.riders r ON r.id = o.rider_id WHERE r.profile_id = $1 ORDER BY o.placed_at DESC LIMIT $2',
            [profileId, limit],
          )
        ).rows;
      }
      return (await db.query('SELECT * FROM public.orders WHERE customer_id = $1 ORDER BY placed_at DESC LIMIT $2', [profileId, limit])).rows;
    },

    async getOrderAccessContext(idOrCode, viewerProfileId) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrCode);
      const order = (
        await db.query(isUuid ? 'SELECT * FROM public.orders WHERE id = $1' : 'SELECT * FROM public.orders WHERE public_code = $1', [idOrCode])
      ).rows[0];
      if (!order) return null;
      const vendor = (await db.query('SELECT * FROM public.vendors WHERE id = $1', [order.vendor_id])).rows[0];
      const rider = order.rider_id ? (await db.query('SELECT profile_id FROM public.riders WHERE id = $1', [order.rider_id])).rows[0] : null;
      const staff = (
        await db.query('SELECT role FROM public.vendor_staff_members WHERE vendor_id = $1 AND profile_id = $2 AND is_active = true', [
          vendor.id, viewerProfileId,
        ])
      ).rows[0];
      return { order, vendor, riderProfileId: rider?.profile_id ?? null, staffRole: staff?.role ?? null };
    },

    async getOrderItemsAndEvents(orderId) {
      const [items, events] = await Promise.all([
        db.query('SELECT * FROM public.order_items WHERE order_id = $1', [orderId]),
        db.query('SELECT * FROM public.order_events WHERE order_id = $1 ORDER BY created_at ASC', [orderId]),
      ]);
      return { items: items.rows, events: events.rows };
    },

    async transitionOrder(input) {
      return (
        await db.query('SELECT * FROM public.transition_order($1,$2,$3,$4,$5::jsonb)', [
          input.orderId, input.actorId, input.actorKind, input.toStatus, JSON.stringify(input.meta),
        ])
      ).rows[0];
    },

    async snoozeMenuItems(vendorId, itemIds, minutes) {
      if (itemIds.length === 0) return 0;
      const res = await db.query(
        `UPDATE public.menu_items SET unavailable_until = clock_timestamp() + ($3 || ' minutes')::interval
         WHERE vendor_id = $1 AND id = ANY($2::uuid[]) RETURNING id`,
        [vendorId, itemIds, String(minutes)],
      );
      return res.rows.length;
    },

    async verifyPickupHandover(input) {
      return (
        await db.query('SELECT * FROM public.verify_pickup_handover($1,$2,$3,$4,$5,$6,$7::text[])', [
          input.orderId, input.actorProfileId, input.secret, input.qrToken,
          input.code4, input.feedbackRating, input.feedbackTags,
        ])
      ).rows[0];
    },

    async recordRiderPickupFeedback(orderId, rating, tags) {
      return (
        await db.query(
          'UPDATE public.orders SET pickup_feedback_rating = $2, pickup_feedback_tags = $3::text[] WHERE id = $1 RETURNING *',
          [orderId, rating, tags],
        )
      ).rows[0];
    },

    async getRiderCashGateByProfile(profileId) {
      return (await db.query('SELECT * FROM public.rider_cash_balance_v WHERE profile_id = $1', [profileId])).rows[0] ?? null;
    },

    async listCustomerOrderReviews(orderId, reviewerId) {
      return (await db.query(
        `SELECT id, direction, rating, aspect_tags, comment, created_at
         FROM public.reviews WHERE order_id = $1 AND reviewer_id = $2
         AND direction IN ('customer_to_vendor', 'customer_to_rider') ORDER BY created_at ASC`,
        [orderId, reviewerId],
      )).rows;
    },

    async submitOrderReview(input) {
      return (
        await db.query(
          `INSERT INTO public.reviews (order_id, reviewer_id, direction, rating, aspect_tags, comment, photo_urls)
           VALUES ($1,$2,$3,$4,$5::text[],$6,$7::text[]) RETURNING *`,
          [input.orderId, input.reviewerId, input.direction, input.rating, input.aspectTags, input.comment, input.photoUrls],
        )
      ).rows[0];
    },

    async replyToReview(reviewId, vendorOperatorId, replyText) {
      const op = await this.getOperatorVendor(vendorOperatorId);
      if (!op) return null;
      return (
        await db.query(
          `UPDATE public.reviews SET vendor_reply = $3, vendor_replied_at = clock_timestamp()
           WHERE id = $1 AND vendor_id = $2 RETURNING *`,
          [reviewId, op.vendor.id, replyText],
        )
      ).rows[0] ?? null;
    },

    async listOrderChatMessages(orderId, pairKind) {
      const chat = (await db.query('SELECT * FROM public.chats WHERE order_id = $1 AND pair_kind = $2', [orderId, pairKind])).rows[0] ?? null;
      if (!chat) return { chat: null, messages: [] };
      const messages = (await db.query('SELECT * FROM public.chat_messages WHERE chat_id = $1 ORDER BY created_at ASC', [chat.id])).rows;
      return { chat, messages };
    },

    async postOrderChatMessage(input) {
      const chat = (
        await db.query(
          `INSERT INTO public.chats (order_id, pair_kind) VALUES ($1, $2)
           ON CONFLICT (order_id, pair_kind) DO UPDATE SET updated_at = clock_timestamp() RETURNING *`,
          [input.orderId, input.pairKind],
        )
      ).rows[0];
      return (
        await db.query(
          `INSERT INTO public.chat_messages (chat_id, sender_id, body, media_public_id, voice_duration_sec)
           VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [chat.id, input.senderId, input.body, input.mediaPublicId, input.voiceDurationSec],
        )
      ).rows[0];
    },

    async listSupportThreads(requesterId, isAdmin) {
      return isAdmin
        ? (await db.query('SELECT * FROM public.support_threads ORDER BY created_at DESC')).rows
        : (await db.query('SELECT * FROM public.support_threads WHERE requester_id = $1 ORDER BY created_at DESC', [requesterId])).rows;
    },

    async createSupportThread(input) {
      const thread = (
        await db.query(
          `INSERT INTO public.support_threads (requester_id, requester_role, order_id, category, subject, priority)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [input.requesterId, input.requesterRole, input.orderId, input.category, input.subject, input.priority],
        )
      ).rows[0];
      const message = (
        await db.query(
          `INSERT INTO public.support_messages (thread_id, sender_id, is_internal_note, body, attachment_public_ids)
           VALUES ($1,$2,false,$3,$4::text[]) RETURNING *`,
          [thread.id, input.requesterId, input.initialBody, input.attachmentPublicIds],
        )
      ).rows[0];
      return { thread, message };
    },

    async listSupportMessages(threadId, viewerId, isAdmin) {
      const th = (await db.query('SELECT requester_id FROM public.support_threads WHERE id = $1', [threadId])).rows[0];
      if (!th || (!isAdmin && th.requester_id !== viewerId)) return null;
      return (
        await db.query(
          `SELECT * FROM public.support_messages
           WHERE thread_id = $1 AND ($2::boolean = true OR is_internal_note = false)
           ORDER BY created_at ASC`,
          [threadId, isAdmin],
        )
      ).rows;
    },

    async postSupportMessage(input) {
      const th = (await db.query('SELECT requester_id FROM public.support_threads WHERE id = $1', [input.threadId])).rows[0];
      if (!th || (!input.isAdmin && th.requester_id !== input.senderId)) return null;
      return (
        await db.query(
          `INSERT INTO public.support_messages (thread_id, sender_id, is_internal_note, body, attachment_public_ids)
           VALUES ($1,$2,false,$3,$4::text[]) RETURNING *`,
          [input.threadId, input.senderId, input.body, input.attachmentPublicIds],
        )
      ).rows[0];
    },

    async getOperatorVendor(profileId) {
      const own = (await db.query('SELECT * FROM public.vendors WHERE owner_profile_id = $1 LIMIT 1', [profileId])).rows[0];
      if (own) return { vendor: own, operatorRole: 'owner' };
      const st = (await db.query('SELECT vendor_id, role FROM public.vendor_staff_members WHERE profile_id = $1 AND is_active = true LIMIT 1', [profileId])).rows[0];
      if (!st) return null;
      const v = (await db.query('SELECT * FROM public.vendors WHERE id = $1', [st.vendor_id])).rows[0];
      return v ? { vendor: v, operatorRole: st.role } : null;
    },

    async updateOperatorVendor(vendorId, patch) {
      return (
        await db.query(
          `UPDATE public.vendors SET
             is_active = coalesce($2, is_active),
             busy_mode_extra_minutes = coalesce($3, busy_mode_extra_minutes),
             accepts_pickup = coalesce($4, accepts_pickup),
             min_order_poisha = coalesce($5, min_order_poisha),
             logo_url = coalesce($6, logo_url),
             cover_url = coalesce($7, cover_url)
           WHERE id = $1 RETURNING *`,
          [
            vendorId, patch.is_active ?? null, patch.busy_mode_extra_minutes ?? null,
            patch.accepts_pickup ?? null, patch.min_order_poisha ?? null,
            patch.logo_url ?? null, patch.cover_url ?? null,
          ],
        )
      ).rows[0];
    },

    async upsertMenuCategory(vendorId, categoryId, input) {
      if (categoryId) {
        return (
          await db.query(
            'UPDATE public.menu_categories SET name_en = $3, name_bn = $4, sort = $5, is_active = $6 WHERE id = $1 AND vendor_id = $2 RETURNING *',
            [categoryId, vendorId, input.name_en, input.name_bn, input.sort, input.is_active],
          )
        ).rows[0];
      }
      return (
        await db.query(
          'INSERT INTO public.menu_categories (vendor_id, name_en, name_bn, sort, is_active) VALUES ($1,$2,$3,$4,$5) RETURNING *',
          [vendorId, input.name_en, input.name_bn, input.sort, input.is_active],
        )
      ).rows[0];
    },

    async upsertMenuItem(vendorId, itemId, input) {
      if (itemId) {
        return (
          await db.query(
            `UPDATE public.menu_items SET
               name_en = coalesce($3, name_en),
               price_poisha = coalesce($4, price_poisha),
               is_available = coalesce($5, is_available),
               image_url = coalesce($6, image_url)
             WHERE id = $1 AND vendor_id = $2 RETURNING *`,
            [itemId, vendorId, input.name_en ?? null, input.price_poisha ?? null, input.is_available ?? null, input.image_url ?? null],
          )
        ).rows[0];
      }
      return (
        await db.query(
          `INSERT INTO public.menu_items (vendor_id, category_id, name_en, name_bn, price_poisha, image_url)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [vendorId, input.category_id, input.name_en, input.name_bn ?? input.name_en, input.price_poisha, input.image_url ?? null],
        )
      ).rows[0];
    },

    async submitVendorKycDoc(vendorId, docType, storagePath, expiresOn) {
      return (
        await db.query(
          'INSERT INTO public.vendor_documents (vendor_id, doc_type, storage_path, expires_on) VALUES ($1,$2,$3,$4) RETURNING *',
          [vendorId, docType, storagePath, expiresOn],
        )
      ).rows[0];
    },

    async getVendorFinanceSummary(vendorId, includePayoutDetails) {
      const [inv, led, pay] = await Promise.all([
        db.query(`SELECT * FROM public.invoices WHERE payee_type = 'vendor' AND payee_id = $1 ORDER BY period_start DESC`, [vendorId]),
        db.query(`SELECT * FROM public.ledger_entries WHERE actor_type = 'vendor' AND actor_id = $1 ORDER BY created_at DESC`, [vendorId]),
        includePayoutDetails
          ? db.query('SELECT method, holder_name, masked, is_primary FROM public.vendor_payout_accounts WHERE vendor_id = $1 AND is_primary = true LIMIT 1', [vendorId])
          : Promise.resolve({ rows: [] }),
      ]);
      return { invoices: inv.rows, ledger: led.rows, payout: includePayoutDetails ? (pay.rows[0] ?? null) : null };
    },

    async getRiderSelfProfile(profileId) {
      const rider = (await db.query('SELECT * FROM public.riders WHERE profile_id = $1', [profileId])).rows[0];
      if (!rider) return null;
      const cashGate = await this.getRiderCashGateByProfile(profileId);
      return { rider, cash_gate: cashGate };
    },

    async submitRiderKycDoc(profileId, docType, storagePath, expiresOn) {
      const r = (await db.query('SELECT id FROM public.riders WHERE profile_id = $1', [profileId])).rows[0];
      if (!r) throw new Error('RIDER_NOT_FOUND');
      return (
        await db.query(
          'INSERT INTO public.rider_documents (rider_id, doc_type, storage_path, expires_on) VALUES ($1,$2,$3,$4) RETURNING *',
          [r.id, docType, storagePath, expiresOn],
        )
      ).rows[0];
    },

    async submitRiderRemittance(input) {
      const r = (await db.query('SELECT id FROM public.riders WHERE profile_id = $1', [input.profileId])).rows[0];
      if (!r) throw new Error('RIDER_NOT_FOUND');
      return (
        await db.query('SELECT * FROM public.submit_cash_remittance($1,$2,$3,$4,$5,$6,$7,$8)', [
          r.id, input.method, input.amountPoisha, input.bkashTrxid,
          input.senderNumber, input.screenshotPublicId, input.senderName, input.selfiePublicId,
        ])
      ).rows[0];
    },

    async getRiderFinanceSummary(profileId) {
      const r = (await db.query('SELECT id FROM public.riders WHERE profile_id = $1', [profileId])).rows[0];
      if (!r) return null;
      const [cashGate, remittances, invoices, ledger] = await Promise.all([
        this.getRiderCashGateByProfile(profileId),
        db.query('SELECT * FROM public.rider_cash_remittances WHERE rider_id = $1 ORDER BY created_at DESC', [r.id]),
        db.query(`SELECT * FROM public.invoices WHERE payee_type = 'rider' AND payee_id = $1 ORDER BY period_start DESC`, [r.id]),
        db.query(`SELECT * FROM public.ledger_entries WHERE actor_type = 'rider' AND actor_id = $1 ORDER BY created_at DESC`, [r.id]),
      ]);
      return { cash_gate: cashGate, remittances: remittances.rows, invoices: invoices.rows, ledger: ledger.rows };
    },
  };
}
