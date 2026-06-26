"""Synthetic authentication-event generator for Sentinel.

We model a population of user accounts and a stream of login *attempts* against
them over a fixed window. Most traffic is benign; a small fraction is
account-takeover (ATO) activity injected as realistic campaigns.

The hard part of this problem — and the reason the model is not trivial — is
**overlap**. Real benign users do suspicious-looking things, and real attackers
try to blend in:

  * Benign users travel internationally (new country + ASN + device), buy new
    phones, mistype passwords in bursts, and log in through VPNs.
  * Attackers run *stealthy* campaigns: local compromise from a residential ASN
    during business hours, "low-and-slow" credential stuffing from rotating IPs
    that never trips a per-IP rate threshold.

So an "impossible travel from Moscow on a new device" event might be a real
vacation, and a quiet local login might be a takeover. That irreducible overlap
is what keeps PR-AUC realistic instead of a suspicious 1.0, and it's what the
gradient-boosted model has to tease apart from weak, correlated signals.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .geo import ATTACKER_CITIES, CITIES, HOME_CITIES

DEVICE_TYPES = ["mobile", "desktop", "tablet"]
DEVICE_OS = {
    "mobile": ["ios", "android"],
    "desktop": ["windows", "macos", "linux"],
    "tablet": ["ios", "android"],
}

RESIDENTIAL_ASN = (1000, 9999)
HOSTING_ASN = (60000, 65000)  # data-centre / VPN / proxy ranges


@dataclass
class User:
    user_id: str
    home_city: str
    country: str
    lat: float
    lon: float
    account_age_days: int
    active_hours: tuple[int, int]
    devices: list[str]
    device_meta: dict[str, tuple[str, str]]
    home_asn: int
    base_rate_per_day: float


def _rng(seed: int) -> np.random.Generator:
    return np.random.default_rng(seed)


def _residential_asn(rng) -> int:
    return int(rng.integers(*RESIDENTIAL_ASN))


def _hosting_asn(rng) -> int:
    return int(rng.integers(*HOSTING_ASN))


def _ip_for_asn(asn: int, rng) -> str:
    return f"{asn % 223 + 1}.{rng.integers(0, 256)}.{rng.integers(0, 256)}.{rng.integers(1, 255)}"


def _make_users(n_users: int, rng) -> list[User]:
    users: list[User] = []
    for i in range(n_users):
        city = HOME_CITIES[rng.integers(len(HOME_CITIES))]
        country, lat, lon = CITIES[city]
        n_devices = int(rng.integers(1, 4))
        devices = [f"d_{i}_{j}" for j in range(n_devices)]
        device_meta = {}
        for d in devices:
            dt = DEVICE_TYPES[rng.integers(len(DEVICE_TYPES))]
            os = DEVICE_OS[dt][rng.integers(len(DEVICE_OS[dt]))]
            device_meta[d] = (dt, os)
        start = int(rng.integers(6, 11))
        users.append(
            User(
                user_id=f"u_{i:05d}",
                home_city=city,
                country=country,
                lat=float(lat + rng.normal(0, 0.05)),
                lon=float(lon + rng.normal(0, 0.05)),
                account_age_days=int(rng.integers(15, 2000)),
                active_hours=(start, start + int(rng.integers(8, 13))),
                devices=devices,
                device_meta=device_meta,
                home_asn=_residential_asn(rng),
                base_rate_per_day=float(rng.uniform(0.3, 4.0)),
            )
        )
    return users


def _jitter(lat, lon, rng, scale=0.04) -> tuple[float, float]:
    return float(lat + rng.normal(0, scale)), float(lon + rng.normal(0, scale))


def _event(*, event_id, user, ts, country, lat, lon, asn, ip, device_id, device_type,
           os, auth_method, outcome, is_ato, attack_type) -> dict:
    return {
        "event_id": f"e_{event_id:08d}",
        "user_id": user.user_id,
        "ts": ts,
        "country": country,
        "lat": round(lat, 5),
        "lon": round(lon, 5),
        "asn": int(asn),
        "ip": ip,
        "device_id": device_id,
        "device_type": device_type,
        "os": os,
        "auth_method": auth_method,
        "outcome": outcome,
        "home_country": user.country,
        "home_lat": round(user.lat, 5),
        "home_lon": round(user.lon, 5),
        "account_age_days": user.account_age_days,
        "active_start": user.active_hours[0],
        "active_end": user.active_hours[1],
        "is_ato": int(is_ato),
        "attack_type": attack_type,
    }


def _benign_login(event_id, user, ts, rng) -> dict:
    """A legitimate login — including the legitimately risky-looking kind."""
    roll = rng.random()
    new_device = rng.random() < 0.06  # bought a new phone / new browser
    if new_device:
        device_id = f"newdev_{rng.integers(0, 10_000_000)}"
        device_type = DEVICE_TYPES[rng.integers(len(DEVICE_TYPES))]
        os = DEVICE_OS[device_type][rng.integers(len(DEVICE_OS[device_type]))]
    else:
        device_id = user.devices[rng.integers(len(user.devices))]
        device_type, os = user.device_meta[device_id]

    if roll < 0.88:  # at/near home
        country, lat, lon = user.country, *_jitter(user.lat, user.lon, rng)
        asn = user.home_asn if rng.random() < 0.85 else _residential_asn(rng)
    elif roll < 0.95:  # domestic travel
        country = user.country
        city = HOME_CITIES[rng.integers(len(HOME_CITIES))]
        _, clat, clon = CITIES[city]
        lat, lon = _jitter(clat, clon, rng)
        asn = _residential_asn(rng)
    else:  # genuine international travel — looks like an attack, but isn't
        city = HOME_CITIES[rng.integers(len(HOME_CITIES))]
        country, clat, clon = CITIES[city]
        lat, lon = _jitter(clat, clon, rng)
        asn = _residential_asn(rng)

    # VPN/proxy usage shows up in benign traffic too
    if rng.random() < 0.05:
        asn = _hosting_asn(rng)

    outcome = "fail" if rng.random() < 0.06 else "success"
    auth_method = "mfa" if rng.random() < 0.25 else ("oauth" if rng.random() < 0.2 else "password")
    return _event(
        event_id=event_id, user=user, ts=ts, country=country, lat=lat, lon=lon, asn=asn,
        ip=_ip_for_asn(asn, rng), device_id=device_id, device_type=device_type, os=os,
        auth_method=auth_method, outcome=outcome, is_ato=0, attack_type="none",
    )


def _attacker_profile(user, stealth, rng) -> tuple[str, str, str, int]:
    """Return (device_id, device_type, os, asn) for a takeover event.

    Stealthy takeovers split into two tiers:
      * *hijack* (~half of stealth) — session-cookie theft or malware on the
        victim's own machine: reuses a real device + the home ASN, so it is
        behaviourally almost indistinguishable from the user. These are the
        attacks no behavioural model can fully catch, which is what keeps recall
        realistic instead of perfect.
      * *blend* — a new device on a residential ASN near home.
    A non-stealth takeover uses a fresh device on a hosting/VPN ASN.
    """
    if stealth and rng.random() < 0.5:  # hijack: ride the victim's own footprint
        dev = user.devices[rng.integers(len(user.devices))]
        dtp, os = user.device_meta[dev]
        return dev, dtp, os, user.home_asn
    if stealth:  # blend in locally on a new device
        dtp = DEVICE_TYPES[rng.integers(len(DEVICE_TYPES))]
        os = DEVICE_OS[dtp][rng.integers(len(DEVICE_OS[dtp]))]
        return f"atk_{rng.integers(0, 99999)}", dtp, os, _residential_asn(rng)
    dtp = DEVICE_TYPES[rng.integers(len(DEVICE_TYPES))]  # loud, obvious takeover
    os = DEVICE_OS[dtp][rng.integers(len(DEVICE_OS[dtp]))]
    return f"atk_{rng.integers(0, 99999)}", dtp, os, _hosting_asn(rng)


def _active_hour_ts(window_start, user, day, rng) -> pd.Timestamp:
    h = user.active_hours[0] + int(rng.integers(0, max(1, (user.active_hours[1] - user.active_hours[0]))))
    return window_start + pd.Timedelta(days=int(day), hours=int(h % 24), minutes=int(rng.integers(0, 60)))


@dataclass
class GenConfig:
    n_users: int = 4000
    days: int = 30
    seed: int = 42
    n_stuffing_campaigns: int = 80
    n_impossible_travel: int = 240
    n_device_takeover: int = 260
    stealth_ratio: float = 0.45  # fraction of takeovers that try to blend in
    extra_fields: list[str] = field(default_factory=list)


def generate(cfg: GenConfig | None = None) -> pd.DataFrame:
    cfg = cfg or GenConfig()
    rng = _rng(cfg.seed)
    users = _make_users(cfg.n_users, rng)

    window_start = pd.Timestamp("2025-05-01T00:00:00Z")
    window_end = window_start + pd.Timedelta(days=cfg.days)
    total_minutes = cfg.days * 24 * 60

    rows: list[dict] = []
    eid = 0

    # --- Benign baseline ---------------------------------------------------
    for user in users:
        n = rng.poisson(user.base_rate_per_day * cfg.days)
        for _ in range(int(n)):
            minute = int(rng.integers(0, total_minutes))
            ts = window_start + pd.Timedelta(minutes=minute)
            if rng.random() < 0.7:  # bias toward the user's active window
                ts = _active_hour_ts(window_start, user, ts.dayofyear % cfg.days, rng)
            rows.append(_benign_login(eid, user, ts, rng))
            eid += 1
            # occasional benign failed-attempt burst (forgot password)
            if rng.random() < 0.03:
                for _ in range(int(rng.integers(2, 5))):
                    ts_f = ts - pd.Timedelta(minutes=int(rng.integers(1, 20)))
                    ev = _benign_login(eid, user, ts_f, rng)
                    ev["outcome"] = "fail"
                    rows.append(ev)
                    eid += 1

    # --- Credential-stuffing campaigns ------------------------------------
    for _ in range(cfg.n_stuffing_campaigns):
        low_and_slow = rng.random() < cfg.stealth_ratio
        size = min(len(users), int(rng.integers(40, 160)))
        targets = rng.choice(len(users), size=size, replace=False)
        start_min = int(rng.integers(0, total_minutes))
        if low_and_slow:
            # rotating residential IPs, spread over many hours -> low per-IP rate
            spread_min = int(rng.integers(60 * 12, 60 * 72))
        else:
            asn = _hosting_asn(rng)
            ip = _ip_for_asn(asn, rng)
            spread_min = int(rng.integers(15, 90))
        for ui in targets:
            user = users[int(ui)]
            ts = window_start + pd.Timedelta(minutes=start_min, seconds=int(rng.integers(0, spread_min * 60)))
            if ts >= window_end:
                continue
            if low_and_slow:
                asn = _residential_asn(rng)
                ip = _ip_for_asn(asn, rng)
                a_country, a_lat, a_lon = CITIES[HOME_CITIES[rng.integers(len(HOME_CITIES))]]
            else:
                a_country, a_lat, a_lon = CITIES[ATTACKER_CITIES[rng.integers(len(ATTACKER_CITIES))]]
            lat, lon = _jitter(a_lat, a_lon, rng, 0.02)
            dtp = DEVICE_TYPES[rng.integers(len(DEVICE_TYPES))]
            os = DEVICE_OS[dtp][rng.integers(len(DEVICE_OS[dtp]))]
            success = rng.random() < (0.08 if not low_and_slow else 0.05)
            rows.append(_event(
                event_id=eid, user=user, ts=ts, country=a_country, lat=lat, lon=lon, asn=asn,
                ip=ip, device_id=f"atk_{rng.integers(0, 99999)}", device_type=dtp, os=os,
                auth_method="password", outcome="success" if success else "fail",
                is_ato=1, attack_type="credential_stuffing",
            ))
            eid += 1

    # --- Impossible-travel / second-session takeovers ---------------------
    for _ in range(cfg.n_impossible_travel):
        user = users[rng.integers(len(users))]
        base_min = int(rng.integers(0, total_minutes - 200))
        ts0 = window_start + pd.Timedelta(minutes=base_min)
        rows.append(_benign_login(eid, user, ts0, rng))
        eid += 1
        stealth = rng.random() < cfg.stealth_ratio
        ts1 = ts0 + pd.Timedelta(minutes=int(rng.integers(8, 120)))
        dev_id, dtp, os, asn = _attacker_profile(user, stealth, rng)
        if stealth:
            a_country, a_lat, a_lon = user.country, *_jitter(user.lat, user.lon, rng, 0.3)
        else:
            a_country, a_lat, a_lon = CITIES[ATTACKER_CITIES[rng.integers(len(ATTACKER_CITIES))]]
        lat, lon = _jitter(a_lat, a_lon, rng, 0.02)
        rows.append(_event(
            event_id=eid, user=user, ts=ts1, country=a_country, lat=lat, lon=lon, asn=asn,
            ip=_ip_for_asn(asn, rng), device_id=dev_id,
            device_type=dtp, os=os, auth_method="password", outcome="success",
            is_ato=1, attack_type="impossible_travel",
        ))
        eid += 1

    # --- New-device / new-geo takeovers -----------------------------------
    for _ in range(cfg.n_device_takeover):
        user = users[rng.integers(len(users))]
        stealth = rng.random() < cfg.stealth_ratio
        day = int(rng.integers(0, cfg.days))
        dev_id, dtp, os, asn = _attacker_profile(user, stealth, rng)
        if stealth:
            ts = _active_hour_ts(window_start, user, day, rng)  # blend into business hours
            a_country, a_lat, a_lon = user.country, *_jitter(user.lat, user.lon, rng, 0.4)
        else:
            ts = window_start + pd.Timedelta(days=day, hours=int(rng.integers(1, 5)), minutes=int(rng.integers(0, 60)))
            a_country, a_lat, a_lon = CITIES[ATTACKER_CITIES[rng.integers(len(ATTACKER_CITIES))]]
        lat, lon = _jitter(a_lat, a_lon, rng, 0.02)
        rows.append(_event(
            event_id=eid, user=user, ts=ts, country=a_country, lat=lat, lon=lon, asn=asn,
            ip=_ip_for_asn(asn, rng), device_id=dev_id,
            device_type=dtp, os=os, auth_method="password", outcome="success",
            is_ato=1, attack_type="new_device_takeover",
        ))
        eid += 1

    df = pd.DataFrame(rows)
    df = df[df["ts"] < window_end].copy()
    df = df.sort_values("ts").reset_index(drop=True)
    df["ts"] = pd.to_datetime(df["ts"], utc=True)
    return df


if __name__ == "__main__":
    from .config import ARTIFACTS_DIR, DATA_PATH

    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    out = generate()
    out.to_parquet(DATA_PATH)
    print(f"Generated {len(out):,} events for {out['user_id'].nunique():,} users")
    print(f"ATO prevalence: {out['is_ato'].mean():.3%}")
    print(out["attack_type"].value_counts().to_string())
