-- Undal — what the device measured when the alarm rang. Licensed under PASVL-1.0.
--
-- D87 closed the delivery loop with `received_at`: the platform's clock stamps the frame
-- and the gap from `sent_at` is the number the device matrix is built from. The device
-- also sends two things the platform cannot observe for itself — how long the push took
-- to reach its own handler, and which path woke it — and until now they were validated
-- and thrown away.
--
-- They are stored under names that say whose number they are. `device_latency_ms` is a
-- claim made by the phone about itself, measured across a network the phone cannot see,
-- and `device_path` is the phone's account of which channel reached it first (`FCM`, the
-- socket, or both). A device that is slow because its radio is asleep will report a
-- latency that looks fine, and a device with a wrong clock will report one that does not;
-- neither is a reason to stop trusting the gap the platform measured. So the columns sit
-- beside `received_at` as evidence, never above it as an authority.
--
-- Both are nullable, and both stay null for a client that does not send them: the receipt
-- is the load-bearing part of the frame, and a missing measurement must not cost the
-- platform its delivery record. `path` is bounded to sixteen characters because core only
-- accepts three names and a longer string is a client bug, not a new path.

ALTER TABLE `fcm_dispatches`
    ADD COLUMN `device_latency_ms` INT         NULL AFTER `received_at`,
    ADD COLUMN `device_path`       VARCHAR(16) NULL AFTER `device_latency_ms`;
