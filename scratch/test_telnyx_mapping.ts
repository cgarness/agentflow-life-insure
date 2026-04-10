
const rawNumbers = [
  {
    phone_number: "+12135550199",
    locality: "Los Angeles",
    region: "CA",
    region_information: [
      { region_name: "US", region_type: "country_code" },
      { region_name: "CA", region_type: "administrative_area" },
      { region_name: "Los Angeles", region_type: "locality" }
    ],
    features: [{ name: "voice" }, { name: "sms" }],
    cost_information: { monthly_cost: "3.00" }
  },
  {
    phone_number: "+13055550200",
    locality: "Miami",
    region: "FL",
    region_information: [
      { region_name: "FL", region_type: "state" },
      { region_name: "Miami", region_type: "locality" }
    ],
    features: [{ name: "voice" }],
    cost_information: { monthly_cost: "5.00" }
  },
  {
    phone_number: "+19999999999",
    // No top level locality
    region_information: [
      { region_name: "US", region_type: "country_code" }
    ],
    features: [],
    cost_information: { monthly_cost: "1.00" }
  }
];

const numbers = (rawNumbers || []).map((n: any) => {
    const regionInfo = n.region_information || [];
    
    // Robustly find locality (city) and administrative_area (state) from region_information
    const locality = regionInfo.find((r: any) => r.region_type === "locality")?.region_name || n.locality || null;
    const region = regionInfo.find((r: any) => r.region_type === "administrative_area" || r.region_type === "state")?.region_name || n.region || null;
    
    return {
        phone_number: n.phone_number,
        locality: locality,
        region: region,
        region_code: region,
        features: n.features,
        monthly_cost: n.cost_information?.monthly_cost || n.monthly_cost || null,
    };
});

console.log(JSON.stringify(numbers, null, 2));
