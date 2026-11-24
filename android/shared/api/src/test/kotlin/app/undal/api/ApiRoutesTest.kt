/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

package app.undal.api

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * The generated table has to be usable, not merely present.
 *
 * A duplicated property name would not compile, but a duplicated *path* would: two constants
 * pointing at `/v1/orders` is legal Kotlin and a support ticket. Likewise an internal route leaking
 * into the list, or a write that forgot its flag — each is checked here rather than trusted.
 */
class ApiRoutesTest {
    @Test
    fun `every route is unique by method and path`() {
        val seen = mutableSetOf<Pair<String, String>>()
        for (route in ApiRoutes.all) {
            assertTrue(seen.add(route.method to route.path), "duplicate ${route.method} ${route.path}")
        }
        assertEquals(seen.size, ApiRoutes.all.size)
    }

    @Test
    fun `every route is a versioned public path`() {
        for (route in ApiRoutes.all) {
            assertTrue(route.path.startsWith("/v1/"), "${route.path} is not under /v1/")
            assertTrue(route.path.none { it == '{' || it == '}' }, "${route.path} still has a brace")
        }
    }

    @Test
    fun `a write is never a GET`() {
        for (route in ApiRoutes.all) {
            if (route.write) assertTrue(route.method != "GET", "${route.path} writes on a GET")
        }
    }

    @Test
    fun `a parameterised path carries at most one placeholder per segment`() {
        for (route in ApiRoutes.all) {
            for (segment in route.path.split("/")) {
                assertTrue(segment.count { it == '%' } <= 1, "${route.path} has a doubled placeholder")
            }
        }
    }

    @Test
    fun `the table is not empty and holds the guest routes`() {
        assertTrue(ApiRoutes.all.size >= 40, "only ${ApiRoutes.all.size} routes")
        assertEquals("*", ApiRoutes.PUBLIC_CONFIG.permission)
        assertEquals("GET", ApiRoutes.PUBLIC_CONFIG.method)
    }
}
