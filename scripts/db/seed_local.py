"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

The local fixtures the integration harness applies to an empty schema.

Fixtures, not seed data. The platform boots empty — `migrations` inserts no vendors, no riders and no
orders, and the guardrail that enforces that stays on. This module exists for the opposite reason:
once a database exists, `integration.py --run` needs *something* to assert against, and a schema with
no rows proves only that the DDL parses.

Every statement is re-runnable. The ids are fixed and readable (`0x11…` for the customer, `0x21…`
for the kitchen), and every insert carries `ON DUPLICATE KEY UPDATE`, so running the harness twice
leaves one zone and not two — a fixture that multiplies on retry is a fixture that makes a test
flaky in a way nobody can see.

The coordinates are Sylhet city centre, because a fixture that says "lat 0, lon 0" is a fixture whose
zone logic nobody has ever exercised.
"""

from __future__ import annotations

#: The id every fixture row is built from: 16 bytes of a repeating nibble, so a failure names itself.
CUSTOMER = "11" * 16
VENDOR_OWNER = "22" * 16
RIDER_USER = "33" * 16
ZONE = "44" * 16
VENDOR = "55" * 16
RIDER = "66" * 16
MENU = "77" * 16
SECTION = "88" * 16
ITEM = "99" * 16

#: A closed ring around Sylhet city centre, in 1e-7 degrees, the way the schema stores every shape.
POLYGON = (
    '{"type":"Polygon","coordinates":[[[91.8600,24.8800],[91.9100,24.8800],'
    '[91.9100,24.9150],[91.8600,24.9150],[91.8600,24.8800]]]}'
)

#: Each statement, with the row it creates named for the failure message.
STATEMENTS: list[tuple[str, str]] = [
    (
        "customer",
        "INSERT INTO `users` (`id`, `phone`, `phone_norm`, `email`, `email_norm`, `password_hash`, "
        "`actor_type`, `status`, `locale`) VALUES "
        f"(UNHEX('{CUSTOMER}'), '+8801711000001', '8801711000001', 'customer@undal.test', "
        "'customer@undal.test', 'x', 'CUSTOMER', 'ACTIVE', 'bn') "
        "ON DUPLICATE KEY UPDATE `phone` = VALUES(`phone`)",
    ),
    (
        "vendor owner",
        "INSERT INTO `users` (`id`, `phone`, `phone_norm`, `email`, `email_norm`, `password_hash`, "
        "`actor_type`, `status`, `locale`) VALUES "
        f"(UNHEX('{VENDOR_OWNER}'), '+8801711000002', '8801711000002', 'kitchen@undal.test', "
        "'kitchen@undal.test', 'x', 'VENDOR_OWNER', 'ACTIVE', 'bn') "
        "ON DUPLICATE KEY UPDATE `phone` = VALUES(`phone`)",
    ),
    (
        "rider user",
        "INSERT INTO `users` (`id`, `phone`, `phone_norm`, `email`, `email_norm`, `password_hash`, "
        "`actor_type`, `status`, `locale`) VALUES "
        f"(UNHEX('{RIDER_USER}'), '+8801711000003', '8801711000003', 'rider@undal.test', "
        "'rider@undal.test', 'x', 'RIDER', 'ACTIVE', 'bn') "
        "ON DUPLICATE KEY UPDATE `phone` = VALUES(`phone`)",
    ),
    (
        "zone",
        "INSERT INTO `zones` (`id`, `code`, `name`, `name_bn`, `city`, `status`, `polygon`, "
        "`bbox_min_lat_e7`, `bbox_max_lat_e7`, `bbox_min_lon_e7`, `bbox_max_lon_e7`, "
        "`centroid_lat_e7`, `centroid_lon_e7`, `area_sq_km`, `created_by`) VALUES "
        f"(UNHEX('{ZONE}'), 'SYL-TEST', 'Sylhet test area', 'সিলেট পরীক্ষা এলাকা', 'Sylhet', 'ACTIVE', "
        f"'{POLYGON}', 248800000, 249150000, 918600000, 919100000, 248975000, 918850000, 20.0, "
        f"UNHEX('{VENDOR_OWNER}')) "
        "ON DUPLICATE KEY UPDATE `status` = 'ACTIVE'",
    ),
    (
        "vendor",
        "INSERT INTO `vendors` (`id`, `owner_user_id`, `kind`, `slug`, `name`, `name_bn`, `phone`, "
        "`zone_id`, `lat_e7`, `lon_e7`, `max_delivery_m`, `address_line`, `status`, `open_state`, "
        "`commission_bps`, `approved_at`, `approved_by`) VALUES "
        f"(UNHEX('{VENDOR}'), UNHEX('{VENDOR_OWNER}'), 'RESTAURANT', 'sylhet-test-kitchen', "
        "'Sylhet Test Kitchen', 'সিলেট টেস্ট কিচেন', '+8801711000002', UNHEX('{ZONE}'), "
        f"248975000, 918850000, 5000, 'Zindabazar, Sylhet', 'APPROVED', 'OPEN', 1500, NOW(6), "
        f"UNHEX('{VENDOR_OWNER}')) "
        "ON DUPLICATE KEY UPDATE `status` = 'APPROVED', `open_state` = 'OPEN'",
    ),
    (
        "menu",
        "INSERT INTO `menus` (`id`, `vendor_id`, `name`, `active`) VALUES "
        f"(UNHEX('{MENU}'), UNHEX('{VENDOR}'), 'Main menu', 1) "
        "ON DUPLICATE KEY UPDATE `active` = 1",
    ),
    (
        "menu section",
        "INSERT INTO `menu_sections` (`id`, `menu_id`, `name`, `name_bn`, `sort_order`) VALUES "
        f"(UNHEX('{SECTION}'), UNHEX('{MENU}'), 'Rice', 'ভাত', 1) "
        "ON DUPLICATE KEY UPDATE `sort_order` = 1",
    ),
    (
        "menu item",
        "INSERT INTO `menu_items` (`id`, `vendor_id`, `section_id`, `name`, `name_bn`, `price_paisa`, "
        "`availability`, `sort_order`) VALUES "
        f"(UNHEX('{ITEM}'), UNHEX('{VENDOR}'), UNHEX('{SECTION}'), 'Chicken biryani', "
        "'চিকেন বিরিয়ানি', 22000, 'AVAILABLE', 1) "
        "ON DUPLICATE KEY UPDATE `price_paisa` = 22000",
    ),
    (
        "rider",
        "INSERT INTO `riders` (`id`, `user_id`, `code`, `full_name`, `vehicle`, `home_zone_id`, "
        "`status`, `shift_state`, `payout_method`, `payout_number`, `payout_name`, `approved_at`) "
        "VALUES "
        f"(UNHEX('{RIDER}'), UNHEX('{RIDER_USER}'), 'RDR-TEST', 'Test Rider', 'MOTORBIKE', "
        f"UNHEX('{ZONE}'), 'APPROVED', 'ONLINE', 'BKASH', '01711000003', 'Test Rider', NOW(6)) "
        "ON DUPLICATE KEY UPDATE `status` = 'APPROVED'",
    ),
]


def statements() -> list[str]:
    """The SQL, in dependency order."""
    return [sql for _, sql in STATEMENTS]
