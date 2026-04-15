CREATE TABLE IF NOT EXISTS telegram_custom_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_user_id BIGINT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    default_lat DOUBLE PRECISION NOT NULL,
    default_lng DOUBLE PRECISION NOT NULL,
    order_history JSONB NOT NULL DEFAULT '{"pending": [], "completed": []}',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hold')),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telegram_vendor (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id UUID REFERENCES telegram_vendor(id),
    category_name TEXT NOT NULL DEFAULT 'Uncategorized'
);

CREATE TABLE IF NOT EXISTS telegram_vendor_item (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id UUID REFERENCES telegram_vendor(id),
    image_url TEXT,
    name TEXT NOT NULL,
    menu_id UUID REFERENCES telegram_vendor_menu(id),
    price INTEGER NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS telegram_cart (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES custom_telegram_users(id),
    vendor_id UUID REFERENCES telegram_vendor(id),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'checked_out', 'cancelled')),
    items JSONB NOT NULL DEFAULT '[]',
    total INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS telegram_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zazu_sub_name TEXT REFERENCES telegram_vendor(name),
    user_id UUID REFERENCES custom_telegram_users(id),
    vendor_id UUID REFERENCES telegram_vendor(id),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','in_progress','delivered','cancelled')),
    subtotal INTEGER NOT NULL,
    delivery_fee INTEGER NOT NULL,
    total INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telegram_bots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bot_id BIGINT NOT NULL UNIQUE,         -- telegram's numeric bot ID from getMe()
    bot_username TEXT NOT NULL UNIQUE,     -- e.g. "ZazuVendorBot"
    bot_token TEXT NOT NULL UNIQUE,        -- the token from BotFather
    vendor_id UUID NOT NULL REFERENCES telegram_vendor(id) ON DELETE CASCADE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES telegram_orders(id),
    zazu_sub_name TEXT REFERENCES telegram_vendor(name),
    paystack_ref TEXT NOT NULL,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','failed'))
);
