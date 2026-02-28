-- Seed data for nutrition default lookup tables

-- ============================================
-- DEFAULT INGREDIENTS (for Meal Builder)
-- ============================================
INSERT INTO default_ingredients (name, emoji, search_term, category, sort_order) VALUES
  -- Proteins
  ('Grilled Chicken', '🍗', 'chicken breast grilled', 'protein', 1),
  ('Ground Beef', '🥩', 'ground beef 90 lean', 'protein', 2),
  ('Eggs', '🥚', 'eggs scrambled', 'protein', 3),
  ('Salmon', '🐟', 'salmon fillet', 'protein', 4),
  ('Turkey Breast', '🦃', 'turkey breast', 'protein', 5),
  ('Steak', '🥩', 'steak sirloin', 'protein', 6),
  ('Shrimp', '🦐', 'shrimp', 'protein', 7),
  ('Tuna', '🐟', 'tuna canned', 'protein', 8),
  ('Pork Chops', '🥩', 'pork chops', 'protein', 9),
  ('Bacon', '🥓', 'bacon', 'protein', 10),
  ('Sausage', '🌭', 'breakfast sausage', 'protein', 11),
  ('Greek Yogurt', '🥛', 'greek yogurt plain', 'protein', 12),
  ('Cottage Cheese', '🧀', 'cottage cheese', 'protein', 13),
  ('Protein Shake', '🥤', 'protein shake whey', 'protein', 14),
  -- Carbs
  ('White Rice', '🍚', 'white rice cooked', 'carb', 1),
  ('Brown Rice', '🍚', 'brown rice cooked', 'carb', 2),
  ('Sweet Potato', '🍠', 'sweet potato baked', 'carb', 3),
  ('Potato', '🥔', 'potato baked', 'carb', 4),
  ('Oatmeal', '🥣', 'oatmeal cooked', 'carb', 5),
  ('Pasta', '🍝', 'pasta cooked', 'carb', 6),
  ('Bread', '🍞', 'bread whole wheat', 'carb', 7),
  ('Quinoa', '🌾', 'quinoa cooked', 'carb', 8),
  ('Tortilla', '🌮', 'tortilla flour', 'carb', 9),
  ('English Muffin', '🧇', 'english muffin', 'carb', 10),
  ('Bagel', '🥯', 'bagel', 'carb', 11),
  -- Vegetables
  ('Broccoli', '🥦', 'broccoli steamed', 'vegetable', 1),
  ('Spinach', '🥬', 'spinach raw', 'vegetable', 2),
  ('Mixed Salad', '🥗', 'mixed greens salad', 'vegetable', 3),
  ('Green Beans', '🫘', 'green beans', 'vegetable', 4),
  ('Asparagus', '🌿', 'asparagus', 'vegetable', 5),
  ('Bell Pepper', '🫑', 'bell pepper', 'vegetable', 6),
  ('Carrots', '🥕', 'carrots', 'vegetable', 7),
  ('Brussels Sprouts', '🥬', 'brussels sprouts', 'vegetable', 8),
  ('Zucchini', '🥒', 'zucchini', 'vegetable', 9),
  ('Mushrooms', '🍄', 'mushrooms', 'vegetable', 10),
  -- Fats
  ('Avocado', '🥑', 'avocado', 'fat', 1),
  ('Olive Oil', '🫒', 'olive oil', 'fat', 2),
  ('Butter', '🧈', 'butter', 'fat', 3),
  ('Peanut Butter', '🥜', 'peanut butter', 'fat', 4),
  ('Almond Butter', '🌰', 'almond butter', 'fat', 5),
  ('Almonds', '🌰', 'almonds', 'fat', 6),
  ('Cheese', '🧀', 'cheddar cheese', 'fat', 7),
  -- Fruits
  ('Banana', '🍌', 'banana', 'fruit', 1),
  ('Apple', '🍎', 'apple', 'fruit', 2),
  ('Berries', '🫐', 'blueberries', 'fruit', 3),
  ('Orange', '🍊', 'orange', 'fruit', 4);

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
