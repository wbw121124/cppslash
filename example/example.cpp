#include <iostream>

int main()
{
  int x = "hello"; // type error
  std::cout << x << std::endl; // ^?
  return 0;
}