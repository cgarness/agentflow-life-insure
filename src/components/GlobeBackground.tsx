import React, { useEffect, useRef } from "react";

const GlobeBackground: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const rotationAngleRef = useRef<number>(0);
  const orbsRef = useRef<
    {
      currentCity: number;
      targetCity: number | null;
      progress: number;
      phase: "waiting" | "traveling";
      waitTimer: number;
      color: string;
      trail: { x: number; y: number }[];
    }[]
  >([]);
  const pulseRingsRef = useRef<
    {
      x: number;
      y: number;
      radius: number;
      maxRadius: number;
      opacity: number;
      color: string;
      duration: number;
      age: number;
    }[]
  >([]);
  const lastTimeRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    let globeRadius = Math.max(canvas.width, canvas.height) * 0.75;
    let globeCenterX = canvas.width / 2;
    let globeCenterY = canvas.height / 2;

    const landPolygons = [
      // North America
      [[70,-140],[65,-168],[60,-145],[54,-130],[48,-124],[38,-122],[30,-117],[22,-110],[18,-104],[15,-90],[15,-83],[18,-66],[25,-77],[30,-81],[35,-76],[40,-74],[45,-66],[47,-53],[55,-57],[60,-64],[65,-60],[70,-63],[75,-80],[75,-120],[70,-140]],
      // South America
      [[12,-72],[10,-62],[5,-52],[0,-50],[-5,-35],[-10,-37],[-15,-39],[-23,-43],[-30,-51],[-33,-52],[-38,-57],[-45,-65],[-52,-68],[-55,-66],[-55,-70],[-45,-73],[-35,-72],[-20,-70],[-10,-78],[-2,-80],[5,-77],[10,-75],[12,-72]],
      // Europe
      [[71,28],[65,14],[58,5],[51,2],[44,8],[36,14],[36,22],[38,26],[41,28],[41,36],[45,35],[48,38],[55,38],[55,22],[58,18],[65,18],[71,28]],
      // Africa
      [[36,10],[30,32],[22,37],[10,42],[0,42],[-10,40],[-18,36],[-26,32],[-34,26],[-34,18],[-22,14],[-18,-12],[-10,-14],[0,-8],[10,-16],[16,-12],[22,-14],[30,-10],[36,10]],
      // Asia
      [[70,30],[65,38],[55,38],[45,38],[35,36],[28,34],[22,60],[10,78],[5,100],[10,105],[22,114],[30,122],[40,128],[50,140],[60,140],[70,140],[70,100],[75,80],[75,60],[70,30]],
      // Australia
      [[-16,130],[-14,136],[-12,136],[-14,142],[-18,146],[-24,152],[-32,152],[-38,146],[-38,140],[-34,136],[-32,114],[-22,114],[-16,122],[-16,130]],
      // Greenland
      [[76,-18],[83,-26],[83,-44],[75,-72],[70,-54],[64,-52],[68,-24],[76,-18]],
    ];

    const cities = [
      { lat: 40.7, lng: -74.0 },
      { lat: 34.0, lng: -118.2 },
      { lat: 41.8, lng: -87.6 },
      { lat: 29.7, lng: -95.3 },
      { lat: 25.7, lng: -80.1 },
      { lat: 33.7, lng: -84.3 },
      { lat: 32.7, lng: -96.7 },
      { lat: 33.4, lng: -112.0 },
      { lat: 47.6, lng: -122.3 },
      { lat: 39.7, lng: -104.9 },
      { lat: 42.3, lng: -71.0 },
      { lat: 36.1, lng: -115.1 },
      { lat: 43.6, lng: -79.3 },
      { lat: 51.5, lng: -0.1 },
      { lat: -33.8, lng: 151.2 },
      { lat: 49.2, lng: -123.1 },
      { lat: 36.1, lng: -86.7 },
      { lat: 28.5, lng: -81.3 },
      { lat: 44.9, lng: -93.2 },
      { lat: 35.2, lng: -80.8 },
    ];

    // Initialize orbs
    if (orbsRef.current.length === 0) {
      const colors = ["#3B82F6", "#14B8A6", "#3B82F6"];
      for (let i = 0; i < 3; i++) {
        orbsRef.current.push({
          currentCity: Math.floor(Math.random() * cities.length),
          targetCity: null,
          progress: 0,
          phase: "waiting",
          waitTimer: 0,
          color: colors[i],
          trail: [],
        });
      }
    }

    function projectPoint(
      lat: number,
      lng: number,
      rotation: number
    ): { x: number; y: number; z: number } | null {
      const latRad = (lat * Math.PI) / 180;
      const lngRad = (lng * Math.PI) / 180;
      const x3d = Math.cos(latRad) * Math.sin(lngRad + rotation);
      const y3d = Math.sin(latRad);
      const z3d = Math.cos(latRad) * Math.cos(lngRad + rotation);
      if (z3d < 0) return null;
      return {
        x: globeCenterX + x3d * globeRadius,
        y: globeCenterY - y3d * globeRadius,
        z: z3d,
      };
    }

    function draw(timestamp: number) {
      if (!ctx || !canvas) return;

      const deltaTime = lastTimeRef.current === 0 ? 16 : timestamp - lastTimeRef.current;
      lastTimeRef.current = timestamp;

      rotationAngleRef.current += 0.0002;
      const rotation = rotationAngleRef.current;

      // DRAW GLOBE BASE
      ctx.fillStyle = "#020408";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const gradient = ctx.createRadialGradient(
        globeCenterX,
        globeCenterY,
        0,
        globeCenterX,
        globeCenterY,
        globeRadius
      );
      gradient.addColorStop(0, "#0A1628");
      gradient.addColorStop(1, "#020408");
      ctx.beginPath();
      ctx.arc(globeCenterX, globeCenterY, globeRadius, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();

      // DRAW GRID LINES
      ctx.strokeStyle = "rgba(59,130,246,0.07)";
      ctx.lineWidth = 0.4;

      // Latitude lines every 30 degrees from -60 to 60
      for (let lat = -60; lat <= 60; lat += 30) {
        ctx.beginPath();
        let started = false;
        for (let lng = -180; lng <= 180; lng += 2) {
          const p = projectPoint(lat, lng, rotation);
          if (p) {
            if (!started) {
              ctx.moveTo(p.x, p.y);
              started = true;
            } else {
              ctx.lineTo(p.x, p.y);
            }
          } else {
            started = false;
          }
        }
        ctx.stroke();
      }

      // Longitude lines every 30 degrees from -180 to 150
      for (let lng = -180; lng <= 150; lng += 30) {
        ctx.beginPath();
        let started = false;
        for (let lat = -90; lat <= 90; lat += 2) {
          const p = projectPoint(lat, lng, rotation);
          if (p) {
            if (!started) {
              ctx.moveTo(p.x, p.y);
              started = true;
            } else {
              ctx.lineTo(p.x, p.y);
            }
          } else {
            started = false;
          }
        }
        ctx.stroke();
      }

      // LAND POLYGONS
      for (const polygon of landPolygons) {
        const projected = polygon.map(([lat, lng]) =>
          projectPoint(lat, lng, rotation)
        );
        const nonNull = projected.filter((p) => p !== null);
        if (nonNull.length / polygon.length < 0.6) continue;

        ctx.beginPath();
        let started = false;
        for (const p of projected) {
          if (p) {
            if (!started) {
              ctx.moveTo(p.x, p.y);
              started = true;
            } else {
              ctx.lineTo(p.x, p.y);
            }
          }
        }
        ctx.closePath();
        ctx.fillStyle = "#0D2137";
        ctx.fill();
        ctx.strokeStyle = "rgba(56,120,190,0.5)";
        ctx.lineWidth = 0.8;
        ctx.stroke();
        ctx.strokeStyle = "rgba(100,160,220,0.15)";
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // UPDATE ORBS
      for (const orb of orbsRef.current) {
        if (orb.phase === "waiting") {
          orb.waitTimer += deltaTime;
          if (orb.waitTimer >= 1200) {
            let target = Math.floor(Math.random() * cities.length);
            while (target === orb.currentCity) {
              target = Math.floor(Math.random() * cities.length);
            }
            orb.targetCity = target;
            orb.phase = "traveling";
            orb.progress = 0;
            orb.trail = [];
          }
        } else if (orb.phase === "traveling") {
          orb.progress += deltaTime / 1400;
          if (orb.progress >= 1) {
            orb.currentCity = orb.targetCity!;
            orb.targetCity = null;
            orb.phase = "waiting";
            orb.waitTimer = 0;
            // Add pulse ring
            const cityPos = projectPoint(
              cities[orb.currentCity].lat,
              cities[orb.currentCity].lng,
              rotation
            );
            if (cityPos) {
              pulseRingsRef.current.push({
                x: cityPos.x,
                y: cityPos.y,
                radius: 8,
                maxRadius: 42,
                opacity: 0.75,
                color: orb.color,
                duration: 900,
                age: 0,
              });
            }
          }
        }
      }

      // DRAW ORBS
      for (const orb of orbsRef.current) {
        if (orb.phase === "traveling" && orb.targetCity !== null) {
          const p1 = projectPoint(
            cities[orb.currentCity].lat,
            cities[orb.currentCity].lng,
            rotation
          );
          const p2 = projectPoint(
            cities[orb.targetCity].lat,
            cities[orb.targetCity].lng,
            rotation
          );
          if (!p1 || !p2) continue;

          const x = p1.x + (p2.x - p1.x) * orb.progress;
          const y = p1.y + (p2.y - p1.y) * orb.progress;
          const arcHeight =
            globeRadius * 0.08 * Math.sin(orb.progress * Math.PI);
          const finalY = y - arcHeight;

          orb.trail.push({ x, y: finalY });

          // Draw trail
          if (orb.trail.length > 1) {
            ctx.beginPath();
            ctx.moveTo(orb.trail[0].x, orb.trail[0].y);
            for (let i = 1; i < orb.trail.length; i++) {
              ctx.lineTo(orb.trail[i].x, orb.trail[i].y);
            }
            const r = parseInt(orb.color.slice(1, 3), 16);
            const g = parseInt(orb.color.slice(3, 5), 16);
            const b = parseInt(orb.color.slice(5, 7), 16);
            ctx.strokeStyle = `rgba(${r},${g},${b},0.4)`;
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }

          // Draw orb
          ctx.shadowBlur = 24;
          ctx.shadowColor = orb.color;
          ctx.beginPath();
          ctx.arc(x, finalY, 5, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(255,255,255,0.9)";
          ctx.fill();
          ctx.shadowBlur = 0;
        } else if (orb.phase === "waiting") {
          const cityPos = projectPoint(
            cities[orb.currentCity].lat,
            cities[orb.currentCity].lng,
            rotation
          );
          if (cityPos) {
            const pulseBlur = 14 + 10 * Math.sin(timestamp * 0.004);
            ctx.shadowBlur = pulseBlur;
            ctx.shadowColor = orb.color;
            ctx.beginPath();
            ctx.arc(cityPos.x, cityPos.y, 5, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(255,255,255,0.9)";
            ctx.fill();
            ctx.shadowBlur = 0;
          }
        }
      }

      // DRAW CITY DOTS
      ctx.shadowBlur = 0;
      for (let i = 0; i < cities.length; i++) {
        const p = projectPoint(cities[i].lat, cities[i].lng, rotation);
        if (!p) continue;

        const activeOrb = orbsRef.current.find(
          (orb) => orb.phase === "waiting" && orb.currentCity === i
        );
        if (activeOrb) {
          const r = parseInt(activeOrb.color.slice(1, 3), 16);
          const g = parseInt(activeOrb.color.slice(3, 5), 16);
          const b = parseInt(activeOrb.color.slice(5, 7), 16);
          ctx.beginPath();
          ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${r},${g},${b},0.75)`;
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(148,163,184,0.45)";
          ctx.fill();
        }
      }

      // PULSE RINGS
      for (let i = pulseRingsRef.current.length - 1; i >= 0; i--) {
        const ring = pulseRingsRef.current[i];
        ring.age += deltaTime;
        ring.radius = 8 + 34 * (ring.age / ring.duration);
        ring.opacity = 0.75 * (1 - ring.age / ring.duration);

        if (ring.age >= ring.duration) {
          pulseRingsRef.current.splice(i, 1);
          continue;
        }

        const r = parseInt(ring.color.slice(1, 3), 16);
        const g = parseInt(ring.color.slice(3, 5), 16);
        const b = parseInt(ring.color.slice(5, 7), 16);
        ctx.beginPath();
        ctx.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${r},${g},${b},${ring.opacity})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // VIGNETTE
      const vignetteGrad = ctx.createRadialGradient(
        canvas.width / 2,
        canvas.height / 2,
        0,
        canvas.width / 2,
        canvas.height / 2,
        Math.max(canvas.width, canvas.height) * 0.7
      );
      vignetteGrad.addColorStop(0, "rgba(2,4,8,0)");
      vignetteGrad.addColorStop(1, "rgba(2,4,8,0.85)");
      ctx.fillStyle = vignetteGrad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      animFrameRef.current = requestAnimationFrame(draw);
    }

    animFrameRef.current = requestAnimationFrame(draw);

    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      globeRadius = Math.max(canvas.width, canvas.height) * 0.75;
      globeCenterX = canvas.width / 2;
      globeCenterY = canvas.height / 2;
    };
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        zIndex: 0,
        pointerEvents: "none",
      }}
    />
  );
};

export default GlobeBackground;
