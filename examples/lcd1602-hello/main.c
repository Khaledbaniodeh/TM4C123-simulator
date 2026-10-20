/*
 * TM4C123 Simulator — firmware example L (Experiment 8)
 *
 * HD44780 LCD1602 in 4-bit mode on Port B, with the Experiment 8 wiring:
 *   RS = PB0, RW = PB1 (also tied to GND), E = PB2, D4-D7 = PB4-PB7.
 * Uses the CMSIS-style device header; SystemInit() sets 50 MHz, and the
 * delays poll SysTick COUNTFLAG.
 *
 * Line 1: "Hello, TM4C123!"
 * Line 2: "LCD1602 <heart> n=X", X counting 0-9 every 200 ms. The heart is a
 *         custom CGRAM character.
 */

#include "TM4C123.h"

#define LCD_RS   (1u << 0)
#define LCD_RW   (1u << 1)
#define LCD_E    (1u << 2)
#define LCD_DATA 0xF0u

static void delay_us(uint32_t us)
{
    SysTick->CTRL = 0u;
    SysTick->LOAD = (SystemCoreClock / 1000000u) * us - 1u;
    SysTick->VAL = 0u;
    SysTick->CTRL = SysTick_CTRL_CLKSOURCE_Msk | SysTick_CTRL_ENABLE_Msk;
    while ((SysTick->CTRL & SysTick_CTRL_COUNTFLAG_Msk) == 0u)
    {
    }
    SysTick->CTRL = 0u;
}

static void delay_ms(uint32_t ms)
{
    while (ms-- > 0u)
    {
        delay_us(1000u);
    }
}

/* One 4-bit transfer: data with E low, then an E pulse (latched on the falling edge). */
static void lcd_nibble(uint32_t nibble, uint32_t rs)
{
    GPIOB->DATA = ((nibble << 4) & LCD_DATA) | rs;   /* E = 0, RW = 0 */
    GPIOB->DATA |= LCD_E;
    delay_us(1u);
    GPIOB->DATA &= ~LCD_E;
}

static void lcd_command(uint32_t command)
{
    lcd_nibble(command >> 4, 0u);
    lcd_nibble(command & 0x0Fu, 0u);
    delay_us(command <= 0x03u ? 2000u : 50u);         /* clear/home: 1.52 ms, others: 37 us */
}

static void lcd_data(uint32_t character)
{
    lcd_nibble(character >> 4, LCD_RS);
    lcd_nibble(character & 0x0Fu, LCD_RS);
    delay_us(50u);
}

static void lcd_print(const char *text)
{
    while (*text != '\0')
    {
        lcd_data((uint8_t)*text++);
    }
}

static void lcd_init(void)
{
    SYSCTL->RCGCGPIO |= (1u << 1);                    /* Port B clock */
    while ((SYSCTL->PRGPIO & (1u << 1)) == 0u)
    {
    }
    GPIOB->DIR |= LCD_DATA | LCD_E | LCD_RW | LCD_RS;
    GPIOB->DEN |= LCD_DATA | LCD_E | LCD_RW | LCD_RS;
    GPIOB->DATA = 0u;

    delay_ms(50u);                                    /* power-on wait */
    lcd_nibble(0x3u, 0u);                             /* initialization by instruction */
    delay_ms(5u);
    lcd_nibble(0x3u, 0u);
    delay_us(200u);
    lcd_nibble(0x3u, 0u);
    delay_us(200u);
    lcd_nibble(0x2u, 0u);                             /* switch to 4-bit mode */
    delay_us(200u);

    lcd_command(0x28u);                               /* 4-bit, 2 lines, 5x8 font */
    lcd_command(0x08u);                               /* display off */
    lcd_command(0x01u);                               /* clear */
    lcd_command(0x06u);                               /* increment, no shift */
    lcd_command(0x0Cu);                               /* display on, cursor off */
}

static const uint8_t heart[8] = { 0x00, 0x0A, 0x1F, 0x1F, 0x1F, 0x0E, 0x04, 0x00 };

int main(void)
{
    uint32_t count = 0u;

    lcd_init();

    lcd_command(0x40u);                               /* CGRAM address 0: character 0 */
    for (uint32_t row = 0u; row < 8u; row++)
    {
        lcd_data(heart[row]);
    }

    lcd_command(0x80u);                               /* line 1 */
    lcd_print("Hello, TM4C123!");
    lcd_command(0xC0u);                               /* line 2 */
    lcd_print("LCD1602 ");
    lcd_data(0x00u);                                  /* custom heart */
    lcd_print(" n=");

    while (1)
    {
        lcd_command(0xC0u + 12u);
        lcd_data('0' + count);
        count = (count + 1u) % 10u;
        delay_ms(200u);
    }
}
