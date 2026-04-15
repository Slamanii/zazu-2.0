CREATE TABLE custom_telegram_users (
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


CREATE TABLE telegram_vendor (
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

CREATE TABLE telegram_vendor_category (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id UUID REFERENCES telegram_vendor(id),
    name TEXT NOT NULL,
    items_list JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT now()
);


CREATE TABLE telegram_vendor_item (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id UUID REFERENCES telegram_vendor(id),
    image_url TEXT,
    name TEXT NOT NULL,
    category_id UUID REFERENCES telegram_vendor_category(id),
    price INTEGER NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE telegram_vendor_menu (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id UUID REFERENCES telegram_vendor(id),
    categories_list JSONB NOT NULL DEFAULT '[]'
);


CREATE TABLE telegram_cart (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES custom_telegram_users(id),
    vendor_id UUID REFERENCES telegram_vendor(id),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'checked_out', 'cancelled')),
    items JSONB NOT NULL DEFAULT '[]',
    total INTEGER NOT NULL DEFAULT 0
);


CREATE TABLE telegram_orders (
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


CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES telegram_orders(id),
    zazu_sub_name TEXT REFERENCES telegram_vendor(name),
    paystack_ref TEXT NOT NULL,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','failed'))
);
