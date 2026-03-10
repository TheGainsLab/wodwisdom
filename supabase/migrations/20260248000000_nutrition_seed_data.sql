-- Seed data for nutrition default lookup tables

-- ============================================
-- DEFAULT INGREDIENTS (for Meal Builder)
-- ============================================
INSERT INTO default_ingredients (name, emoji, category, sort_order) VALUES
  -- Proteins
  ('Grilled Chicken', '🍗', 'protein', 1),
  ('Ground Beef', '🥩', 'protein', 2),
  ('Eggs', '🥚', 'protein', 3),
  ('Salmon', '🐟', 'protein', 4),
  ('Turkey Breast', '🦃', 'protein', 5),
  ('Steak', '🥩', 'protein', 6),
  ('Shrimp', '🦐', 'protein', 7),
  ('Tuna', '🐟', 'protein', 8),
  ('Pork Chops', '🥩', 'protein', 9),
  ('Bacon', '🥓', 'protein', 10),
  ('Sausage', '🌭', 'protein', 11),
  ('Greek Yogurt', '🥛', 'protein', 12),
  ('Cottage Cheese', '🧀', 'protein', 13),
  ('Protein Shake', '🥤', 'protein', 14),
  -- Carbs
  ('White Rice', '🍚', 'carb', 1),
  ('Brown Rice', '🍚', 'carb', 2),
  ('Sweet Potato', '🍠', 'carb', 3),
  ('Potato', '🥔', 'carb', 4),
  ('Oatmeal', '🥣', 'carb', 5),
  ('Pasta', '🍝', 'carb', 6),
  ('Bread', '🍞', 'carb', 7),
  ('Quinoa', '🌾', 'carb', 8),
  ('Tortilla', '🌮', 'carb', 9),
  ('English Muffin', '🧇', 'carb', 10),
  ('Bagel', '🥯', 'carb', 11),
  -- Vegetables
  ('Broccoli', '🥦', 'vegetable', 1),
  ('Spinach', '🥬', 'vegetable', 2),
  ('Mixed Salad', '🥗', 'vegetable', 3),
  ('Green Beans', '🫘', 'vegetable', 4),
  ('Asparagus', '🌿', 'vegetable', 5),
  ('Bell Pepper', '🫑', 'vegetable', 6),
  ('Carrots', '🥕', 'vegetable', 7),
  ('Brussels Sprouts', '🥬', 'vegetable', 8),
  ('Zucchini', '🥒', 'vegetable', 9),
  ('Mushrooms', '🍄', 'vegetable', 10),
  -- Fats
  ('Avocado', '🥑', 'fat', 1),
  ('Olive Oil', '🫒', 'fat', 2),
  ('Butter', '🧈', 'fat', 3),
  ('Peanut Butter', '🥜', 'fat', 4),
  ('Almond Butter', '🌰', 'fat', 5),
  ('Almonds', '🌰', 'fat', 6),
  ('Cheese', '🧀', 'fat', 7),
  -- Fruits
  ('Banana', '🍌', 'fruit', 1),
  ('Apple', '🍎', 'fruit', 2),
  ('Berries', '🫐', 'fruit', 3),
  ('Orange', '🍊', 'fruit', 4);

-- ============================================
-- DEFAULT RESTAURANTS
-- ============================================
INSERT INTO default_restaurants (name, emoji, fatsecret_name, aliases, sort_order) VALUES
  ('Chipotle', '🌯', 'Chipotle Mexican Grill', ARRAY['chipotle mexican grill'], 1),
  ('Panera Bread', '🥖', 'Panera Bread', ARRAY['panera'], 2),
  ('Chick-fil-A', '🐔', 'Chick-fil-A', ARRAY['chickfila', 'chick fil a'], 3),
  ('Starbucks', '☕', 'Starbucks', NULL, 4),
  ('McDonald''s', '🍔', 'McDonald''s', ARRAY['mcdonalds', 'mcdonald', 'mcds'], 5),
  ('Subway', '🥪', 'Subway', NULL, 6),
  ('Taco Bell', '🌮', 'Taco Bell', ARRAY['tacobell'], 7),
  ('Wendy''s', '🍟', 'Wendy''s', ARRAY['wendys', 'wendy'], 8),
  ('Burger King', '👑', 'Burger King', ARRAY['burgerking', 'bk'], 9),
  ('Five Guys', '🍔', 'Five Guys', ARRAY['5 guys', 'fiveguys'], 10),
  ('In-N-Out Burger', '🍔', 'In-N-Out Burger', ARRAY['in n out', 'innout'], 11),
  ('Shake Shack', '🍔', 'Shake Shack', ARRAY['shakeshack'], 12),
  ('Panda Express', '🐼', 'Panda Express', ARRAY['pandaexpress', 'panda'], 13),
  ('Chili''s', '🌶️', 'Chili''s', ARRAY['chilis', 'chili'], 14),
  ('Applebee''s', '🍎', 'Applebee''s', ARRAY['applebees', 'applebee'], 15),
  ('Olive Garden', '🍝', 'Olive Garden', ARRAY['olivegarden'], 16),
  ('Buffalo Wild Wings', '🍗', 'Buffalo Wild Wings', ARRAY['bww', 'bdubs', 'buffalo wild'], 17),
  ('KFC', '🍗', 'KFC', ARRAY['kentucky fried chicken'], 18),
  ('Popeyes', '🍗', 'Popeyes', ARRAY['popeye'], 19),
  ('Domino''s Pizza', '🍕', 'Domino''s Pizza', ARRAY['dominos', 'domino'], 20),
  ('Pizza Hut', '🍕', 'Pizza Hut', ARRAY['pizzahut'], 21),
  ('Arby''s', '🥪', 'Arby''s', ARRAY['arbys', 'arby'], 22),
  ('Jimmy John''s', '🥪', 'Jimmy John''s', ARRAY['jimmy johns', 'jimmyjohns'], 23),
  ('Dunkin''', '🍩', 'Dunkin'' Donuts', ARRAY['dunkin donuts', 'dunkin', 'dd'], 24),
  ('Qdoba', '🌯', 'Qdoba Mexican Grill', ARRAY['qdoba mexican'], 25);

-- ============================================
-- DEFAULT BRANDS
-- ============================================
INSERT INTO default_brands (name, emoji, fatsecret_name, aliases, sort_order) VALUES
  ('Kirkland Signature', '🏪', 'Kirkland Signature', ARRAY['kirkland', 'costco'], 1),
  ('Trader Joe''s', '🛒', 'Trader Joe''s', ARRAY['trader joes', 'traderjoes', 'tj'], 2),
  ('Great Value', '🏪', 'Great Value', ARRAY['walmart'], 3),
  ('Quest Nutrition', '💪', 'Quest Nutrition', ARRAY['quest'], 4),
  ('Premier Protein', '💪', 'Premier Protein', ARRAY['premierprotein'], 5),
  ('Chobani', '🥛', 'Chobani', NULL, 6),
  ('Fage', '🥛', 'Fage', NULL, 7),
  ('KIND', '🥜', 'KIND', ARRAY['kind bars'], 8),
  ('Clif Bar', '🏔️', 'Clif Bar', ARRAY['clifbar', 'clif'], 9),
  ('Nature Valley', '🌿', 'Nature Valley', ARRAY['naturevalley'], 10),
  ('Tyson', '🍗', 'Tyson', NULL, 11),
  ('Perdue', '🐔', 'Perdue', NULL, 12),
  ('Oscar Mayer', '🌭', 'Oscar Mayer', ARRAY['oscarmayer'], 13),
  ('Kraft', '🧀', 'Kraft', NULL, 14),
  ('Muscle Milk', '💪', 'Muscle Milk', ARRAY['musclemilk'], 15),
  ('Dannon', '🥛', 'Dannon', NULL, 16),
  ('Yoplait', '🥛', 'Yoplait', NULL, 17),
  ('Amy''s', '🥘', 'Amy''s Kitchen', ARRAY['amys', 'amys kitchen'], 18),
  ('Stouffer''s', '🥘', 'Stouffer''s', ARRAY['stouffers'], 19),
  ('365 Everyday Value', '🥬', '365 Everyday Value', ARRAY['365', 'whole foods'], 20);
