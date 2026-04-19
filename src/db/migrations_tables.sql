-- Returns riders within radius_km of the given coordinates using Haversine formula
CREATE OR REPLACE FUNCTION telegram_get_nearby_riders(
  user_lat  DOUBLE PRECISION,
  user_lng  DOUBLE PRECISION,
  radius_km DOUBLE PRECISION DEFAULT 10
)
RETURNS TABLE (
  id           UUID,
  latitude     NUMERIC,
  longitude    NUMERIC,
  distance_km  DOUBLE PRECISION
)
LANGUAGE sql
STABLE
AS $$
  SELECT id, latitude, longitude, distance_km
  FROM (
    SELECT
      r.id,
      r.latitude,
      r.longitude,
      ( 6371 * acos(
          LEAST(1.0, cos(radians(user_lat)) * cos(radians(r.latitude::DOUBLE PRECISION))
          * cos(radians(r.longitude::DOUBLE PRECISION) - radians(user_lng))
          + sin(radians(user_lat)) * sin(radians(r.latitude::DOUBLE PRECISION)))
      )) AS distance_km
    FROM public.app_riders_current_status r
    WHERE r.active_mode = 'rider'
  ) sub
  WHERE sub.distance_km <= radius_km
  ORDER BY sub.distance_km ASC;
$$;

CREATE TABLE IF NOT EXISTS telegram_custom_users (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    telegram_user_id BIGINT NOT NULL UNIQUE,
    name TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    default_lat DOUBLE PRECISION,
    default_lng DOUBLE PRECISION,
    order_history JSONB NOT NULL DEFAULT '{"pending": [], "completed": []}',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hold')),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telegram_vendor (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    address TEXT NOT NULL,
    open_time TIME NOT NULL,
    close_time TIME NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    allows_logistics BOOLEAN NOT NULL DEFAULT TRUE,
    acct_type TEXT NOT NULL DEFAULT 'vendor' CHECK (acct_type IN ('vendor', 'Handy-man', 'service-provider')),
    phone TEXT NOT NULL,
    email TEXT NOT NULL,
    message_body TEXT,
    acct_details JSONB,
    order_history JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telegram_vendor_menu (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vendor_id BIGINT NOT NULL REFERENCES telegram_vendor(id),
    category_name TEXT NOT NULL DEFAULT 'Uncategorized',
    CONSTRAINT unique_vendor_category UNIQUE (vendor_id, category_name)
);

CREATE TABLE IF NOT EXISTS telegram_vendor_item (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vendor_id BIGINT REFERENCES telegram_vendor(id),
    image_url TEXT,
    name TEXT NOT NULL,
    menu_id BIGINT REFERENCES telegram_vendor_menu(id),
    price BIGINT NOT NULL,
    stock BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS telegram_cart (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT REFERENCES telegram_custom_users(telegram_user_id),
    vendor_id BIGINT REFERENCES telegram_vendor(id),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'checked_out', 'cancelled')),
    items JSONB NOT NULL DEFAULT '[]',
    total BIGINT NOT NULL DEFAULT 0,
    cart_message_id BIGINT,
    CONSTRAINT telegram_cart_user_vendor_unique UNIQUE (user_id, vendor_id)
);


CREATE TABLE IF NOT EXISTS telegram_orders (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    zazu_sub_name TEXT REFERENCES telegram_vendor(name),
    user_id BIGINT REFERENCES telegram_custom_users(telegram_user_id),
    vendor_id BIGINT REFERENCES telegram_vendor(id),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','in_progress','delivered','cancelled')),
    subtotal BIGINT NOT NULL,
    delivery_fee BIGINT NOT NULL,
    total BIGINT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telegram_bots (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    bot_id BIGINT NOT NULL UNIQUE,         -- telegram's numeric bot ID from getMe()
    bot_username TEXT NOT NULL UNIQUE,     -- e.g. "ZazuVendorBot"
    bot_token TEXT NOT NULL UNIQUE,        -- the token from BotFather
    vendor_id BIGINT NOT NULL REFERENCES telegram_vendor(id) ON DELETE CASCADE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telegram_payments (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id BIGINT NOT NULL REFERENCES telegram_orders(id),
    zazu_sub_name TEXT REFERENCES telegram_vendor(name),
    paystack_ref TEXT NOT NULL,
    amount BIGINT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','failed'))
);
