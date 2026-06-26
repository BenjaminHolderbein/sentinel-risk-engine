"""Small geography helpers shared by the generator and feature engineering.

The haversine implementation here is mirrored verbatim in the TypeScript
scorer (``web/lib/scoring/geo.ts``); a parity test asserts the two agree.
"""

from __future__ import annotations

import math

EARTH_RADIUS_KM = 6371.0


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two WGS84 points, in kilometres."""
    rlat1, rlat2 = math.radians(lat1), math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(rlat1) * math.cos(rlat2) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(a)))


# A compact world of cities the simulator draws from. Each is (country, lat, lon).
# Spread across continents so "impossible travel" attacks produce realistic
# intercontinental velocities.
CITIES: dict[str, tuple[str, float, float]] = {
    "San Francisco": ("US", 37.7749, -122.4194),
    "New York": ("US", 40.7128, -74.0060),
    "Chicago": ("US", 41.8781, -87.6298),
    "Austin": ("US", 30.2672, -97.7431),
    "Toronto": ("CA", 43.6532, -79.3832),
    "London": ("GB", 51.5074, -0.1278),
    "Berlin": ("DE", 52.5200, 13.4050),
    "Paris": ("FR", 48.8566, 2.3522),
    "Amsterdam": ("NL", 52.3676, 4.9041),
    "Lagos": ("NG", 6.5244, 3.3792),
    "Moscow": ("RU", 55.7558, 37.6173),
    "Kyiv": ("UA", 50.4501, 30.5234),
    "Mumbai": ("IN", 19.0760, 72.8777),
    "Singapore": ("SG", 1.3521, 103.8198),
    "Sydney": ("AU", -33.8688, 151.2093),
    "Sao Paulo": ("BR", -23.5505, -46.6333),
    "Tokyo": ("JP", 35.6762, 139.6503),
}

# Cities that disproportionately host attack infrastructure in this simulation.
# (Purely synthetic; used only to make campaigns cluster realistically.)
ATTACKER_CITIES = ["Lagos", "Moscow", "Kyiv", "Singapore", "Sao Paulo"]
HOME_CITIES = ["San Francisco", "New York", "Chicago", "Austin", "Toronto", "London", "Berlin"]
