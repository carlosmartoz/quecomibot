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
    console.log("saveMealForUser: Skipping saving error message as meal");

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
        console.log(
          "saveMealForUser: Skipping saving meal with empty description"
        );

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
        console.error("saveMealForUser: Error saving meal to database:", error);
      } else {
        console.log("saveMealForUser: Meal saved successfully:", data);
      }
    }
  } catch (error) {
    console.error("saveMealForUser: Error parsing or saving meal data:", error);
  }
}

// Get daily summary of meals for a user from memory
function getDailySummary(userId) {
  if (!userMeals.has(userId) || userMeals.get(userId).length === 0) {
    return "¡Vaya! 🤔 Parece que tu estómago está muy silencioso hoy, ¡aún no has registrado ninguna comida! 🍽️";
  }

  const meals = userMeals.get(userId);

  let summary = "🍽️ ¡Veamos qué deliciosas comidas tuviste hoy! 😋\n\n";

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
      console.error(
        "getTodaysMealsFromDB: Error fetching meals from database:",
        error
      );

      return "¡Ups! 😅 Tuve un pequeño tropiezo buscando tus comidas. ¿Me das otra oportunidad? 🙏";
    }

    if (!data || data.length === 0) {
      return "¡Vaya! 🤔 Parece que tu estómago está muy silencioso hoy, ¡aún no has registrado ninguna comida! 🍽️";
    }

    return formatMealSummary(data);
  } catch (error) {
    console.error("getTodaysMealsFromDB:", error);

    return "¡Ups! 😅 Tuve un pequeño tropiezo buscando tus comidas. ¿Me das otra oportunidad? 🙏";
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
    "getArgentinaDateRange: UTC search range:",
    todayStartUTC.toISOString(),
    "a",
    todayEndUTC.toISOString()
  );

  console.log(
    "getArgentinaDateRange: Local dates:",
    todayStartUTC.toLocaleString(),
    "to",
    todayEndUTC.toLocaleString()
  );

  return { todayStartUTC, todayEndUTC };
}

// Format meal summary from database data
function formatMealSummary(meals) {
  let summary = "🍽️ ¡Veamos qué deliciosas comidas tuviste hoy! 😋\n\n";

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

    summary += `🔥 Calorías: ${meal.kcal || "0"} kcal\n`;

    summary += `🥩 Proteínas: ${meal.protein || "0"}g\n`;

    summary += `🥖 Carbohidratos: ${meal.carbohydrates || "0"}g\n`;

    summary += `🥓 Grasas: ${meal.fat || "0"}g\n\n`;

    totalKcal += parseFloat(meal.kcal || 0);

    totalProtein += parseFloat(meal.protein || 0);

    totalCarbs += parseFloat(meal.carbohydrates || 0);

    totalFat += parseFloat(meal.fat || 0);
  });

  summary += `📊 Total del día:\n`;

  summary += `🔥 Calorías totales: ${totalKcal.toFixed(1)} kcal\n`;

  summary += `🥩 Proteínas totales: ${totalProtein.toFixed(1)}g\n`;

  summary += `🥖 Carbohidratos totales: ${totalCarbs.toFixed(1)}g\n`;

  summary += `🥓 Grasas totales: ${totalFat.toFixed(1)}g\n`;

  return summary;
}

// Check if a user has available requests
async function checkUserRequests(userId) {
  try {
    const { data, error } = await supabase
      .from("patients")
      .select("requests, subscription")
      .eq("user_id", userId)
      .single();

    if (error) {
      console.error("checkUserRequests: Error checking user requests:", error);
      return { hasRequests: false, isPremium: false };
    }

    if (data.subscription === "PRO" || data.subscription === "MEDICAL") {
      return { hasRequests: true, isPremium: true };
    }

    return {
      hasRequests: parseInt(data.requests) > 0,
      isPremium: false,
      remainingRequests: parseInt(data.requests),
    };
  } catch (error) {
    console.error("checkUserRequests: ", error);

    return { hasRequests: false, isPremium: false };
  }
}

// Decrement the request counter
async function decrementUserRequests(userId) {
  try {
    const { data: userData, error: userError } = await supabase
      .from("patients")
      .select("subscription, requests")
      .eq("user_id", userId)
      .single();

    if (userError) {
      console.error(
        "decrementUserRequests: Error checking user subscription status:",
        userError
      );

      return false;
    }

    if (
      userData.subscription === "PRO" ||
      userData.subscription === "MEDICAL"
    ) {
      return true;
    }

    if (parseInt(userData.requests) > 0) {
      const { error } = await supabase
        .from("patients")
        .update({ requests: (parseInt(userData.requests) - 1).toString() })
        .eq("user_id", userId);

      if (error) {
        console.error(
          "decrementUserRequests: Error decrementing user requests:",
          error
        );

        return false;
      }

      return true;
    }

    return false;
  } catch (error) {
    console.error(
      "decrementUserRequests: Error in decrementUserRequests:",
      error
    );

    return false;
  }
}

// Update user subscription
async function updateUserSubscription(userId) {
  try {
    const now = new Date();

    now.setHours(now.getHours() - 3);

    const timestampUTC = now.toISOString();

    const updateData = {
      subscription: "PRO",
      requests: "PRO",
      start_date: timestampUTC,
    };

    const { error: patientError } = await supabase
      .from("patients")
      .update(updateData)
      .eq("user_id", userId);

    if (patientError) {
      console.error(
        "updateUserSubscription: Error updating patient subscription:",
        patientError
      );

      throw patientError;
    }

    console.log(
      `updateUserSubscription: Successfully updated subscription for user ${userId} to PRO starting from ${timestampUTC}`
    );

    return true;
  } catch (error) {
    console.error(
      "updateUserSubscription: Error updating user subscription:",
      error
    );

    throw error;
  }
}

// Function to check subscriptions
async function checkSubscriptions() {
  try {
    const now = new Date();

    const notificationDate = new Date(
      now.getTime() - 27 * 24 * 60 * 60 * 1000
    ).toISOString();

    const expirationDate = new Date(
      now.getTime() - 30 * 24 * 60 * 60 * 1000
    ).toISOString();

    const { data: usersToNotify, error: notifyError } = await supabase
      .from("patients")
      .select("user_id, start_date")
      .eq("subscription", "PRO")
      .lt("start_date", notificationDate)
      .gt("start_date", expirationDate);

    if (notifyError) {
      console.error(
        "checkSubscriptions: Error fetching users to notify:",
        notifyError
      );

      throw notifyError;
    }

    const { data: expiredUsers, error: expiredError } = await supabase
      .from("patients")
      .select("user_id, start_date")
      .eq("subscription", "PRO")
      .lt("start_date", expirationDate);

    if (expiredError) {
      console.error(
        "checkSubscriptions: Error fetching expired users:",
        expiredError
      );

      throw expiredError;
    }

    return { usersToNotify, expiredUsers };
  } catch (error) {
    console.error("checkSubscriptions:Error checking subscriptions:", error);

    throw error;
  }
}

// Function to revert to FREE subscription
async function revertToFreeSubscription(userId) {
  try {
    const updateData = {
      subscription: "FREE",
      requests: "20",
      start_date: null,
    };

    const { error } = await supabase
      .from("patients")
      .update(updateData)
      .eq("user_id", userId);

    if (error) throw error;

    console.log(
      `revertToFreeSubscription: Successfully reverted subscription to FREE for user ${userId}`
    );

    return true;
  } catch (error) {
    console.error(
      "revertToFreeSubscription: Error reverting subscription:",
      error
    );

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

// Function to save patient info
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
        subscription: "FREE",
        requests: "20",
      };

      const { data, error } = await supabase
        .from("patients")
        .insert([newPatient]);

      if (error) throw error;

      return data;
    }
  } catch (error) {
    console.error("savePatientInfo: Error saving patient info:", error);

    throw error;
  }
}

module.exports = {
  supabase,
  saveMealForUser,
  getDailySummary,
  savePatientInfo,
  checkUserRequests,
  getPatientByUserId,
  checkSubscriptions,
  getTodaysMealsFromDB,
  updateUserSubscription,
  decrementUserRequests,
  revertToFreeSubscription,
};
