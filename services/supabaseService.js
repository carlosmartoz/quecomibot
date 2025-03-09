// services/supabaseService.js
const { createClient } = require("@supabase/supabase-js");
const config = require("../config/config");
const mealParser = require("../utils/mealParser");

// Initialize Supabase client
const supabase = createClient(config.supabase.url, config.supabase.anonKey);

// Store user meals in memory
const userMeals = new Map();

// Save meal information for a user
async function saveMealForUser(userId, mealInfo) {
  // Check if this is an error message - don't save errors as meals
  if (
    mealInfo.includes("¡Ups!") ||
    mealInfo.includes("Oops!") ||
    mealInfo.includes("Error") ||
    mealInfo.includes("siesta digestiva")
  ) {
    console.log("Skipping saving error message as meal");
    return;
  }

  // Store in memory
  if (!userMeals.has(userId)) {
    userMeals.set(userId, []);
  }

  const meals = userMeals.get(userId);
  meals.push({
    timestamp: new Date(),
    info: mealInfo,
  });

  try {
    // Parse meal sections from the response
    const foodSections = mealParser.parseMealSections(mealInfo);

    // Get current time in Argentina timezone
    const nowUTC = new Date();
    const nowArgentina = new Date(nowUTC.getTime() - 3 * 60 * 60 * 1000);

    // Process each food section
    for (const section of foodSections) {
      const mealData = mealParser.extractMealData(section);

      // Don't save if we couldn't extract a proper description
      if (!mealData.description) {
        console.log("Skipping saving meal with empty description");
        continue;
      }

      // Save to Supabase
      const { data, error } = await supabase.from("meals").insert([
        {
          user_id: userId,
          description: mealData.description,
          created_at: nowArgentina.toISOString(),
          kcal: mealData.kcal,
          protein: mealData.protein,
          fat: mealData.fat,
          carbohydrates: mealData.carbohydrates,
        },
      ]);

      if (error) {
        console.error("Error saving meal to database:", error);
      } else {
        console.log("Meal saved successfully:", data);
      }
    }
  } catch (error) {
    console.error("Error parsing or saving meal data:", error);
  }
}

// Get daily summary of meals for a user from memory
function getDailySummary(userId) {
  if (!userMeals.has(userId) || userMeals.get(userId).length === 0) {
    return "No has registrado comidas hoy.";
  }

  const meals = userMeals.get(userId);
  let summary = "📋 Resumen del día:\n\n";

  meals.forEach((meal, index) => {
    summary += `🕐 Comida ${
      index + 1
    } (${meal.timestamp.toLocaleTimeString()}):\n${meal.info}\n\n`;
  });

  userMeals.set(userId, []);
  return summary;
}

// Get today's meals from Supabase for a user (Argentina timezone)
async function getTodaysMealsFromDB(userId) {
  try {
    // Get date range in Argentina timezone
    const { todayStartUTC, todayEndUTC } = getArgentinaDateRange();

    // Query Supabase for today's meals
    const { data, error } = await supabase
      .from("meals")
      .select("*")
      .eq("user_id", userId)
      .gte("created_at", todayStartUTC.toISOString())
      .lte("created_at", todayEndUTC.toISOString())
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Error fetching meals from database:", error);
      return "Error al obtener el resumen de comidas. Por favor, intenta nuevamente.";
    }

    if (!data || data.length === 0) {
      return "No has registrado comidas hoy.";
    }

    return formatMealSummary(data);
  } catch (error) {
    console.error("Error in getTodaysMealsFromDB:", error);
    return "Error al obtener el resumen de comidas. Por favor, intenta nuevamente.";
  }
}

// Helper function to get Argentina date range
function getArgentinaDateRange() {
  // Get current date in UTC
  const nowUTC = new Date();

  // Convert to Argentina time (UTC-3)
  const nowArgentina = new Date(nowUTC.getTime() - 3 * 60 * 60 * 1000);
  
  // Create today's date range in Argentina time
  const todayStartArgentina = new Date(nowArgentina);
  todayStartArgentina.setHours(0, 0, 0, 0);
  
  const todayEndArgentina = new Date(nowArgentina);
  todayEndArgentina.setHours(23, 59, 59, 999);
  
  // Para la consulta a Supabase, necesitamos las fechas en UTC
  // Como guardamos las fechas en formato Argentina, no necesitamos convertir de vuelta
  const todayStartUTC = new Date(todayStartArgentina.toISOString());
  const todayEndUTC = new Date(todayEndArgentina.toISOString());
  
  return { todayStartUTC, todayEndUTC };
}

// Format meal summary from database data
function formatMealSummary(meals) {
  let summary = "📋 Resumen de hoy:\n\n";

  // Track total nutritional values
  let totalKcal = 0;
  let totalProtein = 0;
  let totalCarbs = 0;
  let totalFat = 0;

  meals.forEach((meal, index) => {
    // Convert UTC time from Supabase back to Argentina time for display
    const mealTimeUTC = new Date(meal.created_at);
    const mealTimeArgentina = new Date(
      mealTimeUTC.getTime() + 0 * 60 * 60 * 1000
    );

    // Use 24-hour format for time display
    const timeOptions = { hour: "2-digit", minute: "2-digit", hour12: false };
    summary += `🕐 Comida ${index + 1} (${mealTimeArgentina.toLocaleTimeString(
      "es-AR",
      timeOptions
    )}):\n`;
    summary += `🍽️ Plato: ${meal.description || "Sin descripción"}\n`;
    summary += `📊 Nutrientes:\n`;
    summary += `  • Calorías: ${meal.kcal || "0"} kcal\n`;
    summary += `  • Proteínas: ${meal.protein || "0"}g\n`;
    summary += `  • Carbohidratos: ${meal.carbohydrates || "0"}g\n`;
    summary += `  • Grasas: ${meal.fat || "0"}g\n\n`;

    // Add to totals (convert to numbers and handle empty values)
    totalKcal += parseFloat(meal.kcal || 0);
    totalProtein += parseFloat(meal.protein || 0);
    totalCarbs += parseFloat(meal.carbohydrates || 0);
    totalFat += parseFloat(meal.fat || 0);
  });

  // Add total summary section
  summary += `📊 Total del día:\n`;
  summary += `  • Calorías totales: ${totalKcal.toFixed(1)} kcal\n`;
  summary += `  • Proteínas totales: ${totalProtein.toFixed(1)}g\n`;
  summary += `  • Carbohidratos totales: ${totalCarbs.toFixed(1)}g\n`;
  summary += `  • Grasas totales: ${totalFat.toFixed(1)}g\n`;

  return summary;
}

// Add this function to update user subscription status
async function updateUserSubscription(userId, isPremium) {
  try {
    const { data, error } = await supabase
      .from("users")
      .update({ is_premium: isPremium })
      .eq("telegram_id", userId);

    if (error) throw error;
    return data;
  } catch (error) {
    console.error("Error updating user subscription:", error);
    throw error;
  }
}

// Add this function to check if a patient exists
async function getPatientByUserId(userId) {
  try {
    const { data, error } = await supabase
      .from("patients")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error("Error checking patient:", error);
      throw error;
    }

    return data;
  } catch (error) {
    console.error("Error in getPatientByUserId:", error);
    return null;
  }
}

// Add this function to create or update patient information
async function savePatientInfo(userId, patientInfo) {
  try {
    const existingPatient = await getPatientByUserId(userId);
    
    if (existingPatient) {
      // Update existing patient
      const { data, error } = await supabase
        .from("patients")
        .update(patientInfo)
        .eq("user_id", userId);
        
      if (error) throw error;
      return data;
    } else {
      // Create new patient with default values
      const newPatient = {
        user_id: userId,
        name: patientInfo.name || null,
        age: patientInfo.age || null,
        height: patientInfo.height || null,
        weight: patientInfo.weight || null,
        requests: 20, // Default value
        subscription: 'FREE' // Default value
      };
      
      const { data, error } = await supabase
        .from("patients")
        .insert([newPatient]);
        
      if (error) throw error;
      return data;
    }
  } catch (error) {
    console.error("Error saving patient info:", error);
    throw error;
  }
}

module.exports = {
  saveMealForUser,
  getDailySummary,
  getTodaysMealsFromDB,
  updateUserSubscription,
  getPatientByUserId,
  savePatientInfo,
};
