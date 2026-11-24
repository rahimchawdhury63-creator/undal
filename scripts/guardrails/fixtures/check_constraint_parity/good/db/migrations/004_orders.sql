CREATE TABLE `orders` (
  `id` BINARY(16) NOT NULL,
  CONSTRAINT `chk_orders_total_positive` CHECK (`total_paisa` > 0)
);
