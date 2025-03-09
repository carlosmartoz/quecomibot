// Require dependencies
const config = require("../config/config");
const mealParser = require("../utils/mealParser");
const { createClient } = require("@supabase/supabase-js");

// Initialize Supabase client
const supabase = createClient(config.supabase.url, config.supabase.anonKey);

// Store user meals in memory
const userMeals = new Map();

// Save meal information for a user
async function saveMealForUser(userId, mealInfo) {
  if (
    mealInfo.includes("¡Ups!") ||
    mealInfo.includes("Oops!") ||
    mealInfo.includes("Error") ||
    mealInfo.includes("siesta digestiva")
  ) {
    console.log("Skipping saving error message as meal");

    return;
  }

  if (!userMeals.has(userId)) {
    userMeals.set(userId, []);
  }

  const meals = userMeals.get(userId);

  meals.push({
    timestamp: new Date(),

    info: mealInfo,
  });

  try {
    const foodSections = mealParser.parseMealSections(mealInfo);

    const nowUTC = new Date();

    const nowArgentina = new Date(nowUTC.getTime() - 3 * 60 * 60 * 1000);

    for (const section of foodSections) {
      const mealData = mealParser.extractMealData(section);

      if (!mealData.description) {
        console.log("Skipping saving meal with empty description");

        continue;
      }

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
    const { todayStartUTC, todayEndUTC } = getArgentinaDateRange();

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
  const nowUTC = new Date();

  const nowArgentina = new Date(nowUTC.getTime() - 3 * 60 * 60 * 1000);

  const todayStartArgentina = new Date(nowArgentina);

  todayStartArgentina.setHours(0, 0, 0, 0);

  const todayEndArgentina = new Date(nowArgentina);

  todayEndArgentina.setHours(23, 59, 59, 999);

  const todayStartUTC = new Date(
    todayStartArgentina.getTime() + 3 * 60 * 60 * 1000
  );

  const todayEndUTC = new Date(
    todayEndArgentina.getTime() + 3 * 60 * 60 * 1000
  );

  console.log(
    "Rango de búsqueda en UTC:",
    todayStartUTC.toISOString(),
    "a",
    todayEndUTC.toISOString()
  );

  console.log(
    "Fechas en formato local:",
    todayStartUTC.toLocaleString(),
    "a",
    todayEndUTC.toLocaleString()
  );

  return { todayStartUTC, todayEndUTC };
}

// Format meal summary from database data
function formatMealSummary(meals) {
  let summary = "📋 Resumen de hoy:\n\n";

  let totalKcal = 0;

  let totalProtein = 0;

  let totalCarbs = 0;

  let totalFat = 0;

  meals.forEach((meal, index) => {
    const mealTimeUTC = new Date(meal.created_at);

    const mealTimeArgentina = new Date(
      mealTimeUTC.getTime() + 0 * 60 * 60 * 1000
    );

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

    totalKcal += parseFloat(meal.kcal || 0);

    totalProtein += parseFloat(meal.protein || 0);

    totalCarbs += parseFloat(meal.carbohydrates || 0);

    totalFat += parseFloat(meal.fat || 0);
  });

  summary += `📊 Total del día:\n`;

  summary += `  • Calorías totales: ${totalKcal.toFixed(1)} kcal\n`;

  summary += `  • Proteínas totales: ${totalProtein.toFixed(1)}g\n`;

  summary += `  • Carbohidratos totales: ${totalCarbs.toFixed(1)}g\n`;

  summary += `  • Grasas totales: ${totalFat.toFixed(1)}g\n`;

  return summary;
}

// Verificar si un usuario tiene solicitudes disponibles
async function checkUserRequests(userId) {
  try {
    const { data, error } = await supabase
      .from("patients")
      .select("requests, subscription")
      .eq("user_id", userId)
      .single();

    if (error) {
      console.error("Error checking user requests:", error);
      return { hasRequests: false, isPremium: false };
    }

    // Si el usuario es PRO o MEDICAL, siempre tiene solicitudes disponibles
    if (data.subscription === "PRO" || data.subscription === "MEDICAL") {
      return { hasRequests: true, isPremium: true };
    }

    // Verificar si tiene solicitudes disponibles
    return {
      hasRequests: data.requests > 0,
      isPremium: false,
      remainingRequests: data.requests,
    };
  } catch (error) {
    console.error("Error in checkUserRequests:", error);
    return { hasRequests: false, isPremium: false };
  }
}

// Decrementar el contador de solicitudes
async function decrementUserRequests(userId) {
  try {
    // Primero verificamos el tipo de suscripción del usuario
    const { data: userData, error: userError } = await supabase
      .from("patients")
      .select("subscription, requests")
      .eq("user_id", userId)
      .single();

    if (userError) {
      console.error("Error checking user subscription status:", userError);
      return false;
    }

    // Si es PRO o MEDICAL, no decrementamos
    if (
      userData.subscription === "PRO" ||
      userData.subscription === "MEDICAL"
    ) {
      return true;
    }

    // Si es FREE y tiene solicitudes, decrementamos
    if (userData.requests > 0) {
      const { error } = await supabase
        .from("patients")
        .update({ requests: userData.requests - 1 })
        .eq("user_id", userId);

      if (error) {
        console.error("Error decrementing user requests:", error);
        return false;
      }

      return true;
    }

    return false;
  } catch (error) {
    console.error("Error in decrementUserRequests:", error);
    return false;
  }
}

// Modificar la función updateUserSubscription
async function updateUserSubscription(userId, isPremium) {
  try {
    // Convertir el booleano a tipo de suscripción
    const subscriptionType = isPremium ? "PRO" : "FREE";

    // Actualizar en la tabla users (si existe)
    try {
      await supabase
        .from("users")
        .update({ subscription: subscriptionType })
        .eq("telegram_id", userId);
    } catch (userError) {
      console.error(
        "Error updating user subscription in users table:",
        userError
      );
      // Continuamos aunque falle, ya que la tabla principal es patients
    }

    // Actualizar en la tabla patients
    const { error: patientError } = await supabase
      .from("patients")
      .update({ subscription: subscriptionType })
      .eq("user_id", userId);

    if (patientError) throw patientError;

    return true;
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

    if (error && error.code !== "PGRST116") {
      console.error("Error checking patient:", error);

      throw error;
    }

    return data;
  } catch (error) {
    console.error("Error in getPatientByUserId:", error);

    return null;
  }
}

// Modificar la función savePatientInfo para incluir el campo requests
async function savePatientInfo(userId, patientInfo) {
  try {
    const existingPatient = await getPatientByUserId(userId);

    if (existingPatient) {
      const { data, error } = await supabase
        .from("patients")
        .update(patientInfo)
        .eq("user_id", userId);

      if (error) throw error;

      return data;
    } else {
      const newPatient = {
        user_id: userId,
        name: patientInfo.name || null,
        age: patientInfo.age || null,
        height: patientInfo.height || null,
        weight: patientInfo.weight || null,
        subscription: "FREE", // Valor por defecto
        requests: "20", // Valor por defecto para nuevos usuarios
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
  checkUserRequests,
  decrementUserRequests,
};
