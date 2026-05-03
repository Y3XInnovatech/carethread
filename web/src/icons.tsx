import type { SVGProps } from "react";

function Icon(props: SVGProps<SVGSVGElement> & { title?: string }) {
  const { title, children, ...rest } = props;
  return (
    <svg
      width="1.25em"
      height="1.25em"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export function IconBeds(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3 10v9M3 10h5v5H3M8 10h13v9H8M8 10V7a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v3" />
    </Icon>
  );
}

export function IconPulse(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3 12h4l2-7 4 14 2-7h6" />
    </Icon>
  );
}

export function IconWrench(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </Icon>
  );
}

export function IconPeople(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </Icon>
  );
}

export function IconChart(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3 3v18h18M7 16l4-8 4 5 4-9" />
    </Icon>
  );
}

export function IconHeart(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 21s-7-4.35-7-10a5 5 0 0 1 9.5-2 5 5 0 0 1 9.5 2c0 5.65-7 10-7 10z" />
    </Icon>
  );
}

export function IconDroplet(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 2.5c-4 5.5-7 9-7 12a7 7 0 0 0 14 0c0-3-3-6.5-7-12z" />
    </Icon>
  );
}

export function IconWind(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3 8h11M5 12h12M3 16h8" />
    </Icon>
  );
}

export function IconThermometer(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 3a2 2 0 0 0-2 2v7.3a4 4 0 1 0 4 0V5a2 2 0 0 0-2-2z" />
    </Icon>
  );
}
