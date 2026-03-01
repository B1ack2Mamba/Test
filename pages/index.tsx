import type { GetServerSideProps } from "next";

// Главную страницу прячем полностью: всегда уводим в раздел комнат.
export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: "/training",
      permanent: false,
    },
  };
};

export default function Home() {
  return null;
}
