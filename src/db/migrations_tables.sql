CREATE TABLE users (
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


CREATE TABLE vendor (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
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
    acct_details JSONB, -- better than integer if storing config
    order_history JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE category (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id UUID REFERENCES vendor(id), -- optional: NULL for global categories
    name TEXT NOT NULL,
    items_list JSONB NOT NULL DEFAULT '[]',  -- store array of item IDs
    created_at TIMESTAMPTZ DEFAULT now()
);


CREATE TABLE item (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id UUID REFERENCES vendor(id),
    image_url TEXT,
    name TEXT NOT NULL,
    category_id UUID REFERENCES categories(id),
    price INTEGER NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE menu (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id UUID REFERENCES vendor(id),
    categories_list JSONB NOT NULL DEFAULT '[]'  -- store array of item IDs
);


CREATE TABLE cart (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    vendor_id UUID REFERENCES vendor(id),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'checked_out', 'cancelled')),
    items JSONB NOT NULL DEFAULT '[]',  -- store item id + qty + price
    total INTEGER NOT NULL DEFAULT 0
);


CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zazu_sub_name TEXT REFERENCES vendor(name),
    user_id UUID REFERENCES users(id),
    vendor_id UUID REFERENCES vendor(id),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','in_progress','delivered','cancelled')),
    subtotal INTEGER NOT NULL,
    delivery_fee INTEGER NOT NULL,
    total INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);


CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES orders(id),
    zazu_sub_name TEXT REFERENCES vendor(name),
    paystack_ref TEXT NOT NULL,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','failed'))
);
