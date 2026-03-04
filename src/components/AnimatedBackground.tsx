import React, { useEffect, useRef } from "react";

const AnimatedBackground: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const neon = ["#3B82F6", "#A855F7", "#14B8A6"];
    const streamColors = ["#3B82F6", "#14B8A6"];

    const hexToRgb = (hex: string): string => {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return `${r},${g},${b}`;
    };

    // STARS
    const stars = Array.from({ length: 200 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: 0.3 + Math.random() * 1.1,
      phase: Math.random() * Math.PI * 2,
      speed: 0.3 + Math.random() * 0.5,
    }));

    // MATRIX STREAMS
    const streamChars = "01アイウエオ∆∑∏∞≈±√ΩΦ";
    const streams = Array.from({ length: 20 }, () => ({
      x: Math.random() * canvas.width,
      y: -(Math.random() * 500),
      speed: 0.9 + Math.random() * 2.0,
      chars: Array.from({ length: 10 }, () =>
        streamChars[Math.floor(Math.random() * streamChars.length)]
      ),
      color: streamColors[Math.floor(Math.random() * streamColors.length)],
      fontSize: 10 + Math.random() * 3,
    }));

    // PARTICLES
    const particles = Array.from({ length: 65 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.64,
      vy: (Math.random() - 0.5) * 0.64,
      r: 0.8 + Math.random() * 2.0,
      color: neon[Math.floor(Math.random() * neon.length)],
      opacity: 0.18 + Math.random() * 0.4,
    }));

    // LIGHT BEAMS
    const beams = [
      { angle: 0.5, speed: 0.00025, color: "#3B82F6", phase: 0 },
      { angle: 3.3, speed: 0.00017, color: "#A855F7", phase: 3 },
    ];

    // GEO SHAPES
    const shapes = Array.from({ length: 5 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.56,
      vy: (Math.random() - 0.5) * 0.56,
      rot: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.006,
      size: 14 + Math.random() * 26,
      sides: Math.random() > 0.5 ? 6 : 3,
      color: neon[Math.floor(Math.random() * neon.length)],
    }));

    let animationId: number;

    const draw = (timestamp: number) => {
      const W = canvas.width;
      const H = canvas.height;
      const t = timestamp * 0.001;

      ctx.clearRect(0, 0, W, H);

      // STARS
      for (const star of stars) {
        const opacity = 0.3 + 0.55 * Math.abs(Math.sin(t * star.speed + star.phase));
        ctx.beginPath();
        ctx.arc(star.x * W, star.y * H, star.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${opacity})`;
        ctx.fill();
      }

      // NEBULA
      const nebulaConfigs = [
        { cx: W * 0.15, cy: H * 0.25, radius: 380, color: "rgba(59,130,246,0.07)" },
        { cx: W * 0.85, cy: H * 0.78, radius: 420, color: "rgba(139,92,246,0.07)" },
        { cx: W * 0.5, cy: H * 0.08, radius: 280, color: "rgba(20,184,166,0.05)" },
      ];
      for (const n of nebulaConfigs) {
        const grad = ctx.createRadialGradient(n.cx, n.cy, 0, n.cx, n.cy, n.radius);
        grad.addColorStop(0, n.color);
        grad.addColorStop(1, "transparent");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);
      }

      // MATRIX STREAMS
      for (const stream of streams) {
        stream.y += stream.speed;
        if (stream.y > H + 200) {
          stream.y = -(Math.random() * 200);
          stream.x = Math.random() * W;
        }
        ctx.font = `${stream.fontSize}px monospace`;
        const rgb = hexToRgb(stream.color);
        for (let i = 0; i < stream.chars.length; i++) {
          const opacity = 0.6 * Math.pow(0.72, i);
          ctx.fillStyle = `rgba(${rgb},${opacity})`;
          ctx.fillText(stream.chars[i], stream.x, stream.y - i * 15);
          if (Math.random() < 0.007) {
            stream.chars[i] = streamChars[Math.floor(Math.random() * streamChars.length)];
          }
        }
      }

      // PARTICLES
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > W) p.vx *= -1;
        if (p.y < 0 || p.y > H) p.vy *= -1;
      }
      // Connections
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 90) {
            const opacity = (1 - dist / 90) * 0.14;
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(255,255,255,${opacity})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
      // Draw particles
      for (const p of particles) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${hexToRgb(p.color)},${p.opacity})`;
        ctx.shadowBlur = 7;
        ctx.shadowColor = p.color;
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // LIGHT BEAMS
      for (const beam of beams) {
        beam.angle += beam.speed;
        const cx = W / 2;
        const cy = H / 2;
        const len = Math.max(W, H) * 1.5;
        const x1 = cx + Math.cos(beam.angle) * len;
        const y1 = cy + Math.sin(beam.angle) * len;
        const x2 = cx - Math.cos(beam.angle) * len;
        const y2 = cy - Math.sin(beam.angle) * len;
        const opacity = 0.18 + 0.22 * Math.sin(t + beam.phase);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = `rgba(${hexToRgb(beam.color)},${opacity})`;
        ctx.lineWidth = 1;
        ctx.shadowBlur = 28;
        ctx.shadowColor = beam.color;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // GEO SHAPES
      for (const shape of shapes) {
        shape.x += shape.vx;
        shape.y += shape.vy;
        shape.rot += shape.rotSpeed;
        // Wrap at edges
        if (shape.x < -shape.size) shape.x = W + shape.size;
        if (shape.x > W + shape.size) shape.x = -shape.size;
        if (shape.y < -shape.size) shape.y = H + shape.size;
        if (shape.y > H + shape.size) shape.y = -shape.size;

        ctx.save();
        ctx.translate(shape.x, shape.y);
        ctx.rotate(shape.rot);
        ctx.beginPath();
        for (let i = 0; i < shape.sides; i++) {
          const angle = (Math.PI * 2 / shape.sides) * i - Math.PI / 2;
          const px = Math.cos(angle) * shape.size;
          const py = Math.sin(angle) * shape.size;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.strokeStyle = `rgba(${hexToRgb(shape.color)},0.2)`;
        ctx.lineWidth = 1;
        ctx.shadowBlur = 8;
        ctx.shadowColor = shape.color;
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.restore();
      }

      animationId = requestAnimationFrame(draw);
    };

    animationId = requestAnimationFrame(draw);

    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(animationId);
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

export default AnimatedBackground;
