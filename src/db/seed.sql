-- ============================================================
-- RESET DATABASE (correct order)
-- ============================================================
TRUNCATE TABLE telegram_payments  RESTART IDENTITY CASCADE;
TRUNCATE TABLE telegram_orders    RESTART IDENTITY CASCADE;
TRUNCATE TABLE telegram_cart      RESTART IDENTITY CASCADE;
TRUNCATE TABLE telegram_bots      RESTART IDENTITY CASCADE;
TRUNCATE TABLE telegram_vendor_item RESTART IDENTITY CASCADE;
TRUNCATE TABLE telegram_vendor_menu RESTART IDENTITY CASCADE;
TRUNCATE TABLE telegram_vendor    RESTART IDENTITY CASCADE;
TRUNCATE TABLE telegram_custom_users RESTART IDENTITY CASCADE;

-- ============================================================
-- USERS
-- ============================================================
INSERT INTO telegram_custom_users
  (telegram_user_id, name, phone, default_lat, default_lng)
VALUES
  (200001, 'John Doe',     '08030000001', 6.5244, 3.3792),
  (200002, 'Jane Smith',   '08030000002', 6.4654, 3.4064),
  (200003, 'Michael Lee',  '08030000003', 6.6018, 3.3515),
  (200004, 'Ada Obi',      '08030000004', 6.4474, 3.4722);

-- ============================================================
-- VENDORS
-- ============================================================
INSERT INTO telegram_vendor
  (name, address, open_time, close_time, lat, lng, phone, email, message_body)
VALUES
  ('Chicken Republic', 'Ikeja, Lagos',    '08:00', '22:00', 6.6018, 3.3515, '08011111111', 'cr@example.com', 'Tasty fast food'),
  ('Sweet Sensation',  'Lekki Phase 1',   '09:00', '21:00', 6.4474, 3.4722, '08022222222', 'ss@example.com', 'Local & continental meals'),
  ('Mega Bites',       'Yaba, Lagos',     '08:30', '22:30', 6.5095, 3.3713, '08033333333', 'mb@example.com', 'Affordable meals');

-- ============================================================
-- MENUS
-- ============================================================
INSERT INTO telegram_vendor_menu (vendor_id, category_name)
SELECT id, 'Meals' FROM telegram_vendor;

INSERT INTO telegram_vendor_menu (vendor_id, category_name)
SELECT id, 'Drinks' FROM telegram_vendor;

-- ============================================================
-- ITEMS
-- ============================================================
INSERT INTO telegram_vendor_item (vendor_id, name, menu_id, price, stock, image_url)
SELECT
  v.id,
  item.name,
  m.id,
  item.price,
  (random() * 50 + 10)::int,
  'https://picsum.photos/seed/' || item.seed || '/400/300'
FROM telegram_vendor v
JOIN telegram_vendor_menu m ON m.vendor_id = v.id
JOIN (VALUES
  ('Jollof Rice & Chicken', 3500, 'jollof'),
  ('Fried Rice & Beef',     3600, 'friedrice'),
  ('Chicken & Chips',       3000, 'chickenchips'),
  ('Burger Meal',           2800, 'burger'),
  ('Amala & Ewedu',         2500, 'amala'),
  ('Pounded Yam & Egusi',   4000, 'egusi')
) AS item(name, price, seed) ON TRUE
WHERE m.category_name = 'Meals';

INSERT INTO telegram_vendor_item (vendor_id, name, menu_id, price, stock, image_url)
SELECT
  v.id,
  item.name,
  m.id,
  item.price,
  (random() * 100 + 20)::int,
  'https://picsum.photos/seed/' || item.seed || '/400/300'
FROM telegram_vendor v
JOIN telegram_vendor_menu m ON m.vendor_id = v.id
JOIN (VALUES
  ('Coca Cola',     500,  'coke'),
  ('Fanta',         500,  'fanta'),
  ('Sprite',        500,  'sprite'),
  ('Bottled Water', 300,  'water'),
  ('Chapman',       1200, 'chapman')
) AS item(name, price, seed) ON TRUE
WHERE m.category_name = 'Drinks';

-- ============================================================
-- BOTS  (vendor_id resolved by name, not hardcoded)
-- ============================================================
INSERT INTO telegram_bots (bot_id, bot_username, bot_token, vendor_id, is_active, created_at)
SELECT
  8589823390,
  'asap_vendor_bot',
  '8589823390:AAE56F5jcl_JXwJyX_MjDqD70vb4D-X4gwQ',
  id,
  true,
  NOW()
FROM telegram_vendor WHERE name = 'Chicken Republic';

-- ============================================================
-- CARTS  (user_id = telegram_user_id, not id)
-- ============================================================
INSERT INTO telegram_cart (user_id, vendor_id, items, total)
SELECT
  u.telegram_user_id,
  v.id,
  jsonb_build_array(jsonb_build_object('name','Jollof Rice & Chicken','qty',1,'price',3500)),
  3500
FROM telegram_custom_users u
JOIN telegram_vendor v ON v.name = 'Chicken Republic'
WHERE u.name = 'John Doe';

INSERT INTO telegram_cart (user_id, vendor_id, items, total)
SELECT
  u.telegram_user_id,
  v.id,
  jsonb_build_array(jsonb_build_object('name','Burger Meal','qty',2,'price',2800)),
  5600
FROM telegram_custom_users u
JOIN telegram_vendor v ON v.name = 'Mega Bites'
WHERE u.name = 'Jane Smith';

-- ============================================================
-- ORDERS  (user_id = telegram_user_id, not id)
-- ============================================================
INSERT INTO telegram_orders
  (zazu_sub_name, user_id, vendor_id, status, subtotal, delivery_fee, total)
SELECT
  v.name,
  u.telegram_user_id,
  v.id,
  'pending',
  3500, 1000, 4500
FROM telegram_custom_users u
JOIN telegram_vendor v ON v.name = 'Chicken Republic'
WHERE u.name = 'John Doe';

INSERT INTO telegram_orders
  (zazu_sub_name, user_id, vendor_id, status, subtotal, delivery_fee, total)
SELECT
  v.name,
  u.telegram_user_id,
  v.id,
  'delivered',
  5600, 1500, 7100
FROM telegram_custom_users u
JOIN telegram_vendor v ON v.name = 'Mega Bites'
WHERE u.name = 'Jane Smith';
