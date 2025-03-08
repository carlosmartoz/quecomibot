const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

class SupabaseService {
  constructor() {
    this.client = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
  }

  async saveMeal(userId, mealData) {
    const { data, error } = await this.client
      .from('meals')
      .insert([{
        user_id: userId,
        ...mealData,
        created_at: new Date().toISOString()
      }]);

    if (error) throw new Error(`Database error: ${error.message}`);
    return data;
  }

  async getDailyMeals(userId) {
    const today = new Date();
    const argentinaOffset = -3;
    const utcOffset = today.getTimezoneOffset() / 60;
    const offsetDiff = argentinaOffset - utcOffset;
    today.setHours(0 - offsetDiff, 0, 0, 0);

    const { data, error } = await this.client
      .from("meals")
      .select("description, kcal, protein, fat, carbohydrates, created_at")
      .eq("user_id", userId)
      .gte("created_at", today.toISOString())
      .order("created_at", { ascending: true });

    if (error) throw new Error(`Error fetching meals: ${error.message}`);
    return data;
  }
}

module.exports = SupabaseService; 